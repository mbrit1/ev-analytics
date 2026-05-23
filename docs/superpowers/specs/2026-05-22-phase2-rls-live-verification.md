# Phase 2 RLS Live Verification

## Purpose
This check verifies the Phase 2 success criterion that private data is not accessible without a valid session or from another user.

## Script
`scripts/verify-rls-live.mjs`

## Required Environment Variables
- `SUPABASE_URL`
- `SUPABASE_KEY` (or `SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`)
- `RLS_USER1_EMAIL`
- `RLS_USER1_PASSWORD`
- `RLS_USER2_EMAIL`
- `RLS_USER2_PASSWORD`

## Run
```bash
node scripts/verify-rls-live.mjs
```

Or without envs (arguments):
```bash
node scripts/verify-rls-live.mjs \
  --url https://<project>.supabase.co \
  --key <sb_publishable_or_anon_key> \
  --email <user@example.com> \
  --password <password>
```

Optional two-user mode:
```bash
node scripts/verify-rls-live.mjs \
  --url https://<project>.supabase.co \
  --key <sb_publishable_or_anon_key> \
  --email <user1@example.com> \
  --password <password1> \
  --other-email <user2@example.com> \
  --other-password <password2>
```

## What It Verifies
1. Unauthenticated read on `providers` is denied or empty.
2. User 1 can insert a provider row with `user_id = auth.uid()`.
3. User 1 can read that row.
4. User 2 cannot read User 1's row (empty result set).
5. Cleanup delete by owner works.

Single-user fallback (when second user is not provided):
4. Spoofed `user_id` insert is denied (RLS/FK).
5. Cleanup delete by owner works.

## Expected Result
Script exits with code `0` and prints:
- `== RLS live verification passed ==`

Any failing condition exits with code `1` and a concrete error message.

## Verification Evidence
- Date: `2026-05-23` (CEST)
- Mode: two-user verification
- Outcome: passed
- Run result:
  - `[ok] both users authenticated`
  - `[ok] unauthenticated read is denied/empty`
  - `[ok] user1 insert succeeded`
  - `[ok] user1 can read own row`
  - `[ok] user2 cannot read user1 row`
  - `[ok] cleanup succeeded`
- Additional operational confirmations:
  - Public signups are disabled in Supabase Auth.
  - Live DB migration for `charging_sessions.provider_name` and `charging_sessions.tariff_name` was applied.
