# Disposable Supabase local-stack experiment

This experiment checks whether a disposable local Supabase stack can provide
real Auth and PostgREST evidence against the canonical domain schema. It does
not change the application, CI, or canonical Supabase configuration.
The starting schema is commit `daa07b0`; it contains the canonical schema and
does not include selection-history migrations.

The setup uses a separately pinned Supabase CLI `2.120.0` binary for macOS
`darwin_arm64`. The official release archive SHA-256 is
`3b8546cc61aeabab6fd1f68edc7f664ebdfa96bdd6a9b18d8d612708f430ae28`. The
observed host is macOS `26.6.2` arm64 with Node.js `26.8.1` and `psql 17.11`;
Docker and Podman are unavailable. Supabase's native-runtime documentation
requires CLI `2.119.0` or later and Apple silicon with macOS 14 or later; it
recommends Docker for concurrent environments. The experiment uses retained
worktree A, worktree B checked out at `daa07b0`, a dedicated temporary
`SUPABASE_HOME`, and the opt-in config at
[`experiments/supabase-local-stack/config.toml`](../../experiments/supabase-local-stack/config.toml).

Supabase documents its local stack and multiple local projects in its
[Build Anything announcement](https://supabase.com/blog/select-2026-build-anything),
[multiple-project guide](https://supabase.com/docs/guides/local-development/running-multiple-local-projects),
and [Docker and native runtimes guide](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes).

## Procedure

Run the following as one Bash subshell from retained worktree A (`/bin/bash`
3.2 or later). The helper only defines functions when sourced. The script
installs its traps before allocating temporary directories or worktree B, so
setup, import, and harness errors all reach the same cleanup path. The traps
preserve worktree B and retain private recovery files whenever stack cleanup or
safe-path validation fails.

```bash
bash <<'BASH'
set -eu
umask 077
A="$(git rev-parse --show-toplevel)"
source "$A/scripts/supabase-stack-experiment-cleanup.sh"
supabase_stack_experiment_install_cleanup_traps

TASK_TMP_ROOT="$(cd -P "${TMPDIR:-/private/tmp}" && pwd -P)"
B="$TASK_TMP_ROOT/ev-stack-b-$$"
TOOLS="$(mktemp -d "$TASK_TMP_ROOT/ev-stack-tools.XXXXXX")"
SUPABASE_STACK_EXPERIMENT_TOOLS="$TOOLS"
supabase_stack_experiment_register_tools_dir "$TOOLS"
RUNTIME="$(mktemp -d "$TASK_TMP_ROOT/ev-stack-runtime.XXXXXX")"
SUPABASE_STACK_EXPERIMENT_RUNTIME="$RUNTIME"
supabase_stack_experiment_register_runtime_dir "$RUNTIME"
mkdir -m 700 "$RUNTIME/supabase-home"
SUPABASE_HOME="$RUNTIME/supabase-home"
supabase_stack_experiment_register_home "$SUPABASE_HOME"
export SUPABASE_HOME

git worktree add --detach "$B" daa07b0
curl -fL \
  https://github.com/supabase/cli/releases/download/v2.120.0/supabase_darwin_arm64.tar.gz \
  -o "$TOOLS/supabase.tar.gz"
printf '%s  %s\n' \
  3b8546cc61aeabab6fd1f68edc7f664ebdfa96bdd6a9b18d8d612708f430ae28 \
  "$TOOLS/supabase.tar.gz" | shasum -a 256 -c -
tar -xzf "$TOOLS/supabase.tar.gz" -C "$TOOLS"
CLI="$TOOLS/supabase"
SUPABASE_STACK_EXPERIMENT_CLI="$CLI"

CONFIG_TEMPLATE="$A/experiments/supabase-local-stack/config.toml"
supabase_stack_experiment_create_config a "$A/supabase/config.toml" "$CONFIG_TEMPLATE"
supabase_stack_experiment_create_config b "$B/supabase/config.toml" "$CONFIG_TEMPLATE"

id_from_status() {
  node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); if(typeof s.id!=="string"||!s.id) process.exit(1); process.stdout.write(s.id)' "$1"
}

export SUPABASE_EXPERIMENTAL_STACK=1
cd "$A"
SUPABASE_STACK_EXPERIMENT_START_ATTEMPTED=1
SUPABASE_HOME="$SUPABASE_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$CLI" stack start --runtime native --eager --output-format json \
  >"$TOOLS/start-a.json" 2>"$TOOLS/start-a.stderr"
SUPABASE_HOME="$SUPABASE_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$CLI" stack status --output-format json >"$TOOLS/status-a.json" 2>"$TOOLS/status-a.stderr"
ID_A="$(id_from_status "$TOOLS/status-a.json")"
SUPABASE_STACK_EXPERIMENT_ID_A="$ID_A"
cd "$B"
SUPABASE_HOME="$SUPABASE_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$CLI" stack start --runtime native --eager --output-format json \
  >"$TOOLS/start-b.json" 2>"$TOOLS/start-b.stderr"
SUPABASE_HOME="$SUPABASE_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$CLI" stack status --output-format json >"$TOOLS/status-b.json" 2>"$TOOLS/status-b.stderr"
ID_B="$(id_from_status "$TOOLS/status-b.json")"
SUPABASE_STACK_EXPERIMENT_ID_B="$ID_B"

# Import separately into both stacks. The endpoint guard accepts only literal
# loopback; database credentials reach psql through environment variables.
import_schema() {
  node --input-type=module - "$1" "$2" <<'NODE'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const status = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new URL(status.env.DB_URL)
if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== '127.0.0.1' || !db.port) {
  console.error('Refusing schema import: database endpoint is not literal loopback.')
  process.exit(2)
}
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', process.argv[3]], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PGHOST: db.hostname,
    PGPORT: db.port,
    PGUSER: decodeURIComponent(db.username),
    PGPASSWORD: decodeURIComponent(db.password),
    PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
  },
})
console.log(`psql exit status: ${result.status ?? 1}`)
process.exitCode = result.status ?? 1
NODE
}
import_schema "$TOOLS/status-a.json" "$A/supabase/schema.sql"
import_schema "$TOOLS/status-b.json" "$B/supabase/schema.sql"

# Preserve the actual harness status so the EXIT trap receives it on failure.
if node "$A/scripts/supabase-stack-experiment.mjs" \
  "$TOOLS/status-a.json" "$TOOLS/status-b.json" \
  >"$TOOLS/harness.log" 2>&1; then
  echo "Harness passed."
else
  harness_status=$?
  echo "Harness failed; inspect the private log."
  exit "$harness_status"
fi

# The read-only MCP check accepts plain HTTP loopback and emits text content
# only; request headers and credentials remain private.
node --input-type=module - "$TOOLS/status-a.json" <<'NODE'
import { readFileSync } from 'node:fs'

const status = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const endpoint = new URL(status.env.MCP_URL)
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
  console.error('Refusing MCP request: endpoint is not plain HTTP loopback.')
  process.exit(2)
}
const query = `select current_database() as database_name,
  current_setting('server_version') as server_version,
  count(*)::integer as domain_tables
from information_schema.tables
where table_schema = 'public'
  and table_name in ('providers', 'charging_plans', 'provider_plan_selections', 'charging_sessions')`
const response = await fetch(`${endpoint.origin}${endpoint.pathname}?features=database&read_only=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json,text/event-stream' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'execute_sql', arguments: { query } },
  }),
})
const raw = await response.text()
const data = raw.split(/\r?\n/).find((line) => line.startsWith('data: '))?.slice(6) ?? raw
const envelope = JSON.parse(data)
if (!response.ok || envelope.error) {
  console.error(`MCP metadata query failed: HTTP ${response.status}`)
  process.exit(1)
}
const content = (envelope.result?.content ?? [])
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
console.log(JSON.stringify({ httpStatus: response.status, content }))
NODE
exit 0
BASH
```

The MCP query inspects the local database catalog separately from JWT
authorization and row-level security evidence. At shell exit, the helper stops
and destroys tracked IDs, removes only run-created configs that still match
the template, then removes the registered temporary directories. A stop,
destroy, isolated-list, or safe-path failure returns nonzero and retains private
status files, logs, tools, and runtime for bounded manual recovery. Cleanup
diagnostics do not include CLI stderr, endpoint URLs, or status bodies. The
helper always sets `SUPABASE_EXPERIMENTAL_STACK=1` and the dedicated
`SUPABASE_HOME` for lifecycle calls, never invokes a global stack list, and
never removes either worktree.

When cleanup retains recovery files, local diagnostics print their private
`SUPABASE_HOME`, tools, and runtime paths. Keep these paths local. After
verifying the reported tools directory is still the original private
directory, inspect only that home's stack list and manually confirm each ID
belongs to this experiment before stopping or destroying it:

```bash
RECOVERY_HOME='<reported SUPABASE_HOME path>'
RECOVERY_TOOLS='<reported private tools directory>'
RECOVERY_CLI="$RECOVERY_TOOLS/supabase"
SUPABASE_HOME="$RECOVERY_HOME" SUPABASE_EXPERIMENTAL_STACK=1 \
  "$RECOVERY_CLI" stack list --output-format json

# After inspecting the list and confirming one ID belongs to this run:
CONFIRMED_ID='<visually verified run-owned ID>'
SUPABASE_HOME="$RECOVERY_HOME" SUPABASE_EXPERIMENTAL_STACK=1 \
  "$RECOVERY_CLI" stack stop --stack-id "$CONFIRMED_ID"
SUPABASE_HOME="$RECOVERY_HOME" SUPABASE_EXPERIMENTAL_STACK=1 \
  "$RECOVERY_CLI" stack destroy --stack-id "$CONFIRMED_ID" --yes
```

If diagnostics say tools ownership changed, do not execute a CLI from that
path. Use a separately verified copy of the pinned CLI with the reported
`SUPABASE_HOME`; do not run global list or act on unverified IDs.

The stack mode and its CLI lifecycle are experimental. The recovery parser is
intentionally limited to a direct array of `{id}` objects or a
`{stacks:[{id}]}` response; verify the pinned CLI's actual list envelope before
relying on automatic recovery after a failed start. An unknown envelope fails
closed and retains the private recovery files. These steps and their results
apply only to the disposable local environment, not managed Supabase or
production.

## Results

Both initial schema imports exited successfully. Stack A reported API port
`25085`, database port `28219`, and MCP path `/mcp`; stack B reported API port
`20232` and database port `20610`. MCP `initialize` returned HTTP 200 with
server version `0.12.0`; `tools/list` returned JSON-RPC error `-32603` with
`fetch failed`. Adding `?features=database` exposed `execute_sql` as detailed
below.

With the initial config, administrator-created email users could not sign in:
both password-login requests returned HTTP 422. The CLI config showed that
`[auth.email] enable_signup = false` disabled the email provider even though
the top-level `[auth] enable_signup = false` correctly kept public signup
disabled. With the corrected config, email password sign-in succeeded on both
stacks. Public signup remains disabled. This is an experiment configuration
correction, not a change to application policy.

The first harness run exposed two compatibility issues. Node.js 26's global
Web Crypto `crypto.randomUUID` method was unbound when called. The harness
supplies the imported `node:crypto` `randomUUID` through the verifier's
existing `idFactory` seam. The existing verifier also attempted to update
`providers.notes`, which is absent from the canonical schema at `daa07b0`.
The verifier correction is limited to using fields that exist in this
baseline; its authorization, owner-isolation, state, and foreign-key checks
remain in place. After these corrections, the full two-stack harness exited
successfully for both stacks. It covered anonymous and owner CRUD behavior,
cross-user denial, spoofed ownership, six foreign-key attempts, and reverse
cleanup. A full rerun after stopping and destroying both stacks, then
recreating them from the template, also passed both schema imports and both
harness matrices. The fresh API ports remained `25085` and `20232`; database
ports changed from `28219`/`20610` to `26983`/`28653`, confirming the harness
reads endpoints from each run's status JSON.

An independent database marker read returned one row in stack A and zero in
stack B. Authenticated JWT reads also passed. These checks provide direct
database and HTTP authorization evidence for this local schema. They do not
replace the full verifier result.

For MCP, `initialize` returned HTTP 200 and server version `0.12.0`. The
default `tools/list` request returned JSON-RPC error `-32603` with `fetch
failed`; adding `?features=database` returned `execute_sql`. Calling it with
`?features=database&read_only=true` reported database `postgres`, PostgreSQL
`17.11`, and four domain tables. MCP inspection is separate from the
authorization checks above.

Observed service versions were Auth `2.197.0`, PostgREST `16.4`, pg-meta
`0.100.0`, Studio `2026.10.05-sha94b8b06`, and PostgreSQL
`17.11.0.004-r1`.

The focused contract command from the earlier live experiment
`node --test scripts/schema-grants.node-test.mjs scripts/verify-rls-live.node-test.mjs scripts/supabase-stack-experiment.node-test.mjs`
passed 16 tests at that time, before the cleanup helper was added. Those
results describe the earlier harness verification only; the cleanup change
was validated with fake CLI fixtures and did not start a Supabase stack.

The cleanup regression suite passed 28 fake-CLI tests with
`node --test scripts/supabase-stack-experiment-cleanup.node-test.mjs`, and the
sourceable helper passed `bash -n scripts/supabase-stack-experiment-cleanup.sh`.
The current verifier suite passed 17 tests, and the current focused standalone
suites passed 63 tests in total. These are static/fake-fixture results; the
strict rejection assertions and cleanup changes have not been live-rerun. The
historical live matrices did not assert SQLSTATE rejection reasons, so they do
not establish which SQLSTATEs the revised checks return.
The earlier syntax checks covered the live verifier and harness files:

```sh
node --check scripts/verify-rls-live.mjs && \
node --check scripts/verify-rls-live.node-test.mjs && \
node --check scripts/supabase-stack-experiment.mjs && \
node --check scripts/supabase-stack-experiment.node-test.mjs
```

`npm run docs:check` passed for 20 active documentation files, and
`git diff --check` passed. Typecheck was omitted because the slice has no
TypeScript changes. The full application test suite, build, and browser checks
were outside this documentation and local-stack experiment slice.

After the fresh rerun, both owned stack IDs stopped and destroyed with
`runtimeCleanup` complete. The dedicated stack list was empty afterward, and
the temporary runtime home, cache, tools, status files, logs, and generated
configs were removed. Worktree A and its reviewable artifacts were retained;
worktree B remains clean at the schema baseline.

Native mode supported two concurrent stacks, but this does not establish
Docker-mode isolation; Docker was unavailable. The stack API remains
experimental, and default MCP tool discovery failed without the database
feature query. This experiment does not prove managed Supabase or production
behavior, browser/offline behavior, or the forthcoming selection-history
feature.

Recommendation: continue evaluating native mode for disposable local
Auth/PostgREST checks, with its weaker isolation treated as an explicit limit.
