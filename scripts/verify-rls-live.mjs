#!/usr/bin/env node

/**
 * Live RLS verification for Phase 2 tables against a real Supabase project.
 *
 * Usage examples:
 * node scripts/verify-rls-live.mjs \
 *   --url https://<project>.supabase.co \
 *   --key <sb_publishable_or_anon_key> \
 *   --email <user@example.com> \
 *   --password <secret>
 *
 * Optional two-user mode:
 *   --other-email <user2@example.com> --other-password <secret2>
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function printHelp() {
  console.log(`
verify-rls-live.mjs

Required (args or env):
  --url                 (or SUPABASE_URL)
  --key                 (or SUPABASE_KEY / SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY)
  --email               (or RLS_USER1_EMAIL)
  --password            (or RLS_USER1_PASSWORD)

Optional second user:
  --other-email         (or RLS_USER2_EMAIL)
  --other-password      (or RLS_USER2_PASSWORD)

Single-user mode:
  Omitting --other-email/--other-password runs partial verification only:
  unauth read denial + owner read/write + spoofed user_id write denial.
`);
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}

const supabaseUrl = args.url || process.env.SUPABASE_URL;
const anonKey =
  args.key ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const user1Email = args.email || process.env.RLS_USER1_EMAIL;
const user1Password = args.password || process.env.RLS_USER1_PASSWORD;
const user2Email = args['other-email'] || process.env.RLS_USER2_EMAIL;
const user2Password = args['other-password'] || process.env.RLS_USER2_PASSWORD;

if (!supabaseUrl) {
  console.error('[missing] Provide --url or SUPABASE_URL');
  process.exit(1);
}
if (!anonKey) {
  console.error('[missing] Provide --key or SUPABASE_KEY/SUPABASE_ANON_KEY/VITE_SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}
if (!user1Email || !user1Password) {
  console.error('[missing] Provide --email/--password (or RLS_USER1_EMAIL/RLS_USER1_PASSWORD)');
  process.exit(1);
}

const baseHeaders = {
  apikey: anonKey,
  'Content-Type': 'application/json',
};

async function signIn(email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ email, password }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(json)}`);
  }

  return {
    accessToken: json.access_token,
    userId: json.user?.id,
  };
}

async function rest(path, { method = 'GET', token, headers = {}, body } = {}) {
  const mergedHeaders = {
    ...baseHeaders,
    ...headers,
  };

  if (token) {
    mergedHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: mergedHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    json,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log('== RLS live verification start ==');

  const user1 = await signIn(user1Email, user1Password);
  let user2 = null;
  if (user2Email && user2Password) {
    user2 = await signIn(user2Email, user2Password);
  }

  assert(user1.userId, 'User1 id missing in auth response.');
  if (user2) {
    assert(user2.userId, 'User2 id missing in auth response.');
    assert(user1.userId !== user2.userId, 'Users must be different for RLS verification.');
  }

  console.log(user2 ? '[ok] both users authenticated' : '[ok] single user authenticated');

  // 1) Unauthenticated request should not expose private rows.
  const unauthRead = await rest('providers?select=id&limit=1', { method: 'GET' });
  assert(
    unauthRead.status === 401 || (Array.isArray(unauthRead.json) && unauthRead.json.length === 0),
    `Unexpected unauthenticated read result: status=${unauthRead.status}, body=${JSON.stringify(unauthRead.json)}`
  );
  console.log('[ok] unauthenticated read is denied/empty');

  // 2) User1 inserts a provider row with own user_id.
  const providerName = `RLS Probe ${Date.now()}`;
  const insertRes = await rest('providers', {
    method: 'POST',
    token: user1.accessToken,
    headers: { Prefer: 'return=representation' },
    body: [{ user_id: user1.userId, name: providerName }],
  });

  assert(insertRes.ok, `User1 insert failed: status=${insertRes.status}, body=${JSON.stringify(insertRes.json)}`);
  assert(Array.isArray(insertRes.json) && insertRes.json.length === 1, 'User1 insert response did not return one row.');

  const providerId = insertRes.json[0].id;
  assert(providerId, 'Inserted provider id missing.');
  console.log('[ok] user1 insert succeeded');

  // 3) User1 can read own row.
  const user1Read = await rest(`providers?select=id,name,user_id&id=eq.${providerId}`, {
    method: 'GET',
    token: user1.accessToken,
  });
  assert(user1Read.ok, `User1 read failed: status=${user1Read.status}`);
  assert(Array.isArray(user1Read.json) && user1Read.json.length === 1, 'User1 could not read own row.');
  console.log('[ok] user1 can read own row');

  if (user2) {
    // 4) User2 cannot read user1 row (must be empty because of RLS).
    const user2Read = await rest(`providers?select=id,name,user_id&id=eq.${providerId}`, {
      method: 'GET',
      token: user2.accessToken,
    });
    assert(user2Read.ok, `User2 read request failed unexpectedly: status=${user2Read.status}`);
    assert(Array.isArray(user2Read.json) && user2Read.json.length === 0, 'User2 should not read user1 row.');
    console.log('[ok] user2 cannot read user1 row');
  } else {
    // 4-alt) Single-user fallback: spoofed user_id write should fail.
    const spoofInsert = await rest('providers', {
      method: 'POST',
      token: user1.accessToken,
      headers: { Prefer: 'return=representation' },
      body: [{ user_id: '00000000-0000-0000-0000-000000000000', name: `RLS Spoof ${Date.now()}` }],
    });
    assert(!spoofInsert.ok, 'Spoofed user_id insert should fail under RLS/FK constraints.');
    console.log('[ok] spoofed user_id insert denied (single-user fallback)');
  }

  // 5) Cleanup by owner.
  const deleteRes = await rest(`providers?id=eq.${providerId}`, {
    method: 'DELETE',
    token: user1.accessToken,
  });
  assert(deleteRes.ok, `Cleanup delete failed: status=${deleteRes.status}, body=${JSON.stringify(deleteRes.json)}`);
  console.log('[ok] cleanup succeeded');

  console.log('== RLS live verification passed ==');
}

main().catch((error) => {
  console.error('RLS live verification failed:', error.message);
  process.exit(1);
});
