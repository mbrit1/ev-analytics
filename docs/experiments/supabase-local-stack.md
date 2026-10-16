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

The maintained opt-in command, prerequisites, fixed baseline CRUD contract,
revision provenance, cleanup and recovery instructions are in the
[local backend validation runbook](../infrastructure-runbook.md#validate-a-disposable-local-backend).
The command extracts SQL from an explicit immutable Git revision and runs two
complete create/verify/destroy rounds with the current runner; it does not
check out the selected revision or execute its scripts.

The reusable-command results below record its acceptance runs. Earlier dated
sections retain historical evidence from the original experiment and its
corrections; those earlier runs do not establish acceptance for the command.

## Results

### Publication review and lifecycle deadlines: 2026-10-16

Review found that stalled CLI lifecycle commands could block later cleanup.
The runner now bounds startup to ten minutes and status, list, stop and destroy
to one minute each. It sends TERM at the deadline and escalates to KILL after
one second. A timeout returns nonzero; cleanup continues through other owned
actions and retains recovery files. An optional shorter test deadline cannot
extend or disable the production limit.

Behavioral RED for
`node --test --test-name-pattern='times out a stalled stop' scripts/supabase-stack-experiment-cleanup.node-test.mjs`
exceeded its outer five-second guard. GREEN covers stalled start/status/stop
commands that ignore TERM, a stalled recovery list, subsequent cleanup,
retained evidence, original failure status, and invalid timeout overrides.
A further regression caught a helper import invoking the public argument
parser; reordering its internal arguments removed the spurious diagnostic.

The deadline-enabled lifecycle was independently rerun with:

```bash
npm run backend:validate -- --schema-ref afc3e23 --contract baseline-crud-v1
```

Both complete rounds passed with two backends per round. Auth/JWT/PostgREST,
direct database isolation, and database-only MCP metadata passed, including
PostgreSQL `17.11`, MCP `0.12.0`, and four domain tables on each backend.
The selected commit and schema digest matched the acceptance table below.
Each round verified an empty owned stack list; all owned runtime/tools
directories were removed. An early hanging synthetic RED fixture was also
identified and its exact process tree removed; no recovery resources remain.

This live rerun preceded the final helper-import argument correction. That
correction only suppresses unintended argument parsing; the full lifecycle
regression suite and a direct helper invocation verify the final import path.
It does not change schema bytes, CLI arguments, verification or cleanup logic,
so the expensive live rounds were not repeated again. The original two-revision
evidence remains subject to its identical-schema and native-runtime limits.

Final review validation passed `node --test scripts/*.node-test.mjs` with
**134 tests**, plus the Node/Bash syntax checks listed below, `npm run typecheck`,
`npm run docs:check` (**3 tests / 20 active files**), and `git diff --check`.
The publication gate passed lint, **1,115 application tests / 77 files**, and
build with non-secret HTTPS placeholder Supabase configuration. Deadline
fixtures use idle processes and a five-second injected limit to allow
subprocess startup under parallel test load; production limits are unchanged.

### Reusable revision-selected command: 2026-10-16

Status: **passed** for `baseline-crud-v1`. Routine usage and recovery now live
in the [infrastructure runbook](../infrastructure-runbook.md#validate-a-disposable-local-backend).
The historical results below remain evidence of their original experiments.

Changed files are the new `scripts/supabase-local-backend.mjs`,
`scripts/supabase-local-backend.sh`, and
`scripts/supabase-local-backend.node-test.mjs`; the existing
`scripts/supabase-stack-experiment.mjs`,
`scripts/supabase-stack-experiment.node-test.mjs`,
`scripts/supabase-stack-experiment-cleanup.sh`, and
`scripts/supabase-stack-experiment-cleanup.node-test.mjs`; `package.json`;
`docs/infrastructure-runbook.md`; and this report.

The final command selected these immutable sources for `supabase/schema.sql`:

| Requested ref | Resolved commit | Round 1 | Round 2 | Final exit |
| --- | --- | --- | --- | --- |
| `daa07b0` | `daa07b0d7d13e324c8331c47ae85323e29c667d4` | Passed | Passed | 0 |
| `afc3e23` | `afc3e236d3a2d82814af9dd8cf49f295c0337199` | Passed | Passed | 0 |

Both schema files have SHA-256
`08e3fd95fc92017e0251d0fd5a78abf3151a4eb3eb094328136144270aee2c28`.
Their complete schema diff is empty. Inspection confirmed the baseline direct
CRUD grants, owner RLS, selection columns, and six named ownership-scoped
foreign keys used by the existing verifier. This establishes two-revision
selection and repeatability, **not different-schema coverage**.

The live invocations were:

```bash
npm run backend:validate -- --schema-ref daa07b0 --contract baseline-crud-v1
npm run backend:validate -- --schema-ref afc3e23 --contract baseline-crud-v1
```

Both invocations reused an official downloaded CLI archive through
`SUPABASE_LOCAL_CLI_ARCHIVE`; each invocation rechecked its pinned checksum and
CLI version. The four runner/harness/cleanup source files were checksum-checked
before and after the final target runs and were not edited between targets.
The schema was extracted with Git, not checked out, and no target-revision
scripts ran. Each round imported the same digest-checked bytes into both
backends in a transaction. The runner resolved the schema before provisioning.

All four final rounds passed both real Auth/JWT/PostgREST matrices. Each matrix
checked owner CRUD and representations, anonymous denial, spoofed inserts
(HTTP `403` / SQLSTATE `42501`), empty cross-user reads/mutations with owner-state
rechecks, and all six cross-owner FK failures (HTTP `409` / `23503` and the
matching named constraint). Reverse-order probe deletions returned the deleted
rows and subsequent reads confirmed absence. Authenticated REST and direct
PostgreSQL queries confirmed one isolation marker in A and zero in B.

On both backends in every round, database-only read-only MCP discovery exposed
exactly `execute_sql`, `list_extensions`, `list_migrations`, and `list_tables`.
Initialization and metadata requests returned HTTP `200`; the verifier rejected
HTTP, JSON-RPC and tool errors and checked response IDs. Metadata confirmed
`postgres`, PostgreSQL `17.11`, and exactly four domain tables. MCP reported
`0.12.0`. A separate bounded, read-only format probe confirmed the pinned tool's
text content is a JSON object whose `result` string contains the tagged rows.
Only metadata structure and validated values were retained for this report.

The actual CLI start result uses top-level `id`; status uses `identity.id` and
reported `native`, `running`, and `ready`. Its list envelope is
`{"stacks":[],"message":""}` after successful destruction. Each round verified
that empty list before removing owned files. API/database ports were distinct
and literal loopback; MCP used its own stack's loopback API listener.
The host was macOS `26.6.2` arm64, Node.js `26.8.1`, and `psql 17.11`.
CLI `2.120.0` and the native artifact versions matched the runbook's pins.

Three development attempts exited `1` and cleaned their owned resources before
the final runs. The first failure exposed insufficient public diagnostics.
The next confirmed the Auth/CRUD/isolation harness passed but MCP row parsing
failed; an anchored boundary regression reproduced prose mentioning the tag
before its standalone data block. A subsequent live failure exposed the outer
`{result: string}` tool-output object. The decoder now handles that exact
framing and still rejects wrong metadata values, types, mismatched/ambiguous
blocks, JSON-RPC errors, and `isError: true`. These failures are not counted as
passing acceptance runs. No assertion was skipped or weakened.

Final static and integration checks:

```bash
node --test scripts/*.node-test.mjs
node --check scripts/supabase-local-backend.mjs
node --check scripts/supabase-local-backend.node-test.mjs
node --check scripts/supabase-stack-experiment.mjs
node --check scripts/supabase-stack-experiment.node-test.mjs
node --check scripts/supabase-stack-experiment-cleanup.node-test.mjs
bash -n scripts/supabase-local-backend.sh scripts/supabase-stack-experiment-cleanup.sh
npm run docs:check
git diff --check
npm run lint
npm run test -- --run --maxWorkers=2
npm run build
```

The standalone suite passed **128 tests** without failures or skips. Syntax and
diff checks passed. Documentation checks passed **3 tests / 20 active files**.
Lint and build passed; application tests passed **1,115 tests / 77 files**.
The integration gate used non-secret placeholder Supabase configuration, with
no live application connection. A copied-module mutation removing the MCP
tool-error guard produced the expected failing regression; the real source was
not mutated. Fake lifecycle tests also cover partial-start recovery, cleanup
continuation, retained evidence, changed-path ownership, version/checksum
rejection, and redaction. Invalid/missing refs, absent schema paths and an
unsupported contract were also rejected by the real CLI before backend
allocation.

Cleanup verified empty owned stack lists for all final rounds. Task-owned
runtime homes, generated configs, tools, downloaded service caches, CLI copy,
status documents and sensitive diagnostic captures were removed. No recovery
resources remain outstanding. The feature worktree and reviewable uncommitted
changes were retained. Other sessions' worktrees, services and configuration
were not modified.

These are local synthetic native-backend results. They do not establish
container isolation, managed-project or production behavior, browser/offline
replay, physical-device behavior, or selection-history RPC compatibility.
Execution remains opt-in and outside CI; no publication was performed.

### Cleanup reporting fix and approved-network retry: 2026-10-15

Status: **corrected local live revalidation passed**. The local cleanup-reporting
fix is committed separately as `d785c3b`; the existing experiment, verifier, and stack
cleanup commits were preserved. The previous attempt's report edit was the
only uncommitted change at the start of this task.

The harness now catches provisioning failures before final user cleanup and
reports the original safe diagnostic together with every failed deletion.
Partial provisioning cleanup and final cleanup continue across owned users.
Messages identify stack/user ordinals and HTTP status or a static network
failure; raw transport errors, credentials, and response bodies are omitted.
A successful response missing its user ID retains that diagnostic too.

The regression tests exercise the real CLI in a child process with a fake
network boundary installed before module loading. Behavioral RED was
`node --test scripts/supabase-stack-experiment.node-test.mjs`: 9 tests passed
and one failed because provisioning status `503` was missing after partial
cleanup failed. The trace confirmed all deletions were attempted. GREEN passed
11 tests, including combined provisioning/deletion failures, successful
cleanup after provisioning failure, and a malformed provisioning response.
The combined case retained provisioning `503`, partial cleanup `502`, one
sanitized transport failure, and final cleanup `504`, without sensitive bodies.

Integration validation passed `node --test scripts/*.node-test.mjs`: 66 tests,
zero failures or skips. `npm run docs:check` passed three tests and checked
20 active files. `bash -n scripts/supabase-stack-experiment-cleanup.sh` and
`node --check` for both harness files, both live verifier files, and the cleanup
test file passed, as did `git diff --check`. No application dependencies were
installed; application behavior, build, browser, and offline checks were not
part of this backend harness correction.

The supported sandbox escalation approved the official pinned archive and
changelog downloads. The commands used were:

```sh
curl -fL --connect-timeout 20 https://github.com/supabase/cli/releases/download/v2.120.0/supabase_darwin_arm64.tar.gz -o "$TOOLS/supabase.tar.gz"
curl -fL --connect-timeout 20 https://supabase.com/changelog.md -o "$TOOLS/changelog.md"
shasum -a 256 "$TOOLS/supabase.tar.gz"
tar -xzf "$TOOLS/supabase.tar.gz" -C "$TOOLS"
SUPABASE_HOME="$HELP_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$TOOLS/supabase" --version
SUPABASE_HOME="$HELP_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$TOOLS/supabase" stack start --help
SUPABASE_HOME="$HELP_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$TOOLS/supabase" stack status --help
SUPABASE_HOME="$HELP_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$TOOLS/supabase" stack list --help
SUPABASE_HOME="$HELP_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$TOOLS/supabase" stack stop --help
SUPABASE_HOME="$HELP_HOME" SUPABASE_EXPERIMENTAL_STACK=1 "$TOOLS/supabase" stack destroy --help
```

The checksum matched the pin above, and the executable reported `2.120.0`.
Actual help confirmed the documented lifecycle flags. Help/version inspection
also needs a dedicated `SUPABASE_HOME`: an initial invocation without it was
blocked by the sandbox when the CLI attempted a telemetry-file write in the
default home. Subsequent inspection used a private temporary home.
The current changelog and official runtime/multiple-project documentation
were checked; the [PostgreSQL minor-release notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) concerns extension
and custom-operator upgrade cases, not changes to this fresh canonical schema.

The approved live procedure used a new dedicated runtime home and a newly
created detached baseline worktree, reusing only the verified CLI archive.
Stack A reached `Stack is ready`, but the procedure exited after its status
step, before schema import or authorization checks. Cleanup removed the owned
runtime/tools directories and generated configs. A diagnostic retry retained
private status JSON before cleanup so the status-output mismatch could be
inspected without printing connection credentials. It identified a procedure
error: `stack start` returns a top-level `id`, but `stack status` returns
`identity.id`. The procedure above now validates and reads `identity.id`.
The exact extractor passed against captured status JSON; synthetic documents
with only a top-level ID, no identity, or an empty identity ID failed closed
with no output. Both aborted runs returned nonzero and their cleanup recovered
IDs from the real CLI's isolated-home `{stacks:[...]}` list envelope. No schema
import or Auth assertion ran in those attempts.

The corrected run then passed, followed by a separate destroy/recreate run
using a fresh dedicated home and baseline worktree. Each run used the lifecycle,
import, and harness procedure above with database-only MCP initialization and
discovery, copying the already checksum-verified pinned archive into its private
tools directory instead of downloading the CLI again. Both runs exited `0`;
each imported the schema into both stacks with `psql exit status: 0` and passed
the complete two-stack harness. The unchanged verifier required spoofed inserts
to return HTTP `403`/SQLSTATE `42501`, and all six cross-owner references to
return HTTP `409`/`23503` with their matching named FK constraints. Owner
mutation representations, empty cross-user mutation representations, owner
state rechecks, returned deleted probe rows, and subsequent absence reads all
passed on both stacks. The authenticated marker and direct database count
checks confirmed one marker in A and zero in B. These are real local
Auth/JWT/PostgREST and database results, rather than mocked HTTP evidence.

The first corrected run reported A API/database ports `25085`/`32023` and B
ports `29625`/`22256`. Both runtimes reported `native`, `running`, and `ready`.
The native artifacts selected by the pin were Auth `2.197.0`, PostgREST `16.4`,
pg-meta `0.100.0`, Studio `2026.10.05-sha94b8b06`, and PostgreSQL
`17.11.0.004-r1`. The host remained macOS `26.6.2` arm64 with Node.js `26.8.1`
and `psql 17.11`. No Docker/Podman installation or configuration was changed.

In both successful runs, local MCP `initialize` and `tools/list` returned HTTP
`200` using `?features=database&read_only=true`. The MCP server version was
`0.12.0`; the discovered set was exactly `execute_sql`, `list_extensions`,
`list_migrations`, and `list_tables`. The harmless metadata query returned
database `postgres`, PostgreSQL `17.11`, and four domain tables in both runs.
Captured discovery and query results were checked against that exact tool set
and metadata. The procedure now includes explicit discovery checks; no hosted
MCP/project was contacted or linked.

The recreate run also exercised controlled cleanup failure with the real CLI:
an experiment-owned wrapper returned exit `77` only for the exact commands
`stack stop --stack-id "$ID_A"` and
`stack destroy --stack-id "$ID_A" --yes`, forwarding all other calls to the
unchanged pinned executable. Calling `supabase_stack_experiment_cleanup`
returned nonzero, and its call trace contained stop and destroy attempts for
both A and B. Private status JSON, generated configs, tools, and runtime were
retained. The real pinned CLI's
`stack list --output-format json`, under the dedicated `SUPABASE_HOME`, returned
a `{stacks:[...]}` envelope containing exactly A; B had been destroyed. Thus
the injected A failures did not prevent real cleanup of B.

After restoring the pinned executable, recovery used the helper's real list
parser rather than supplying a saved ID:

```bash
SUPABASE_STACK_EXPERIMENT_CLEANUP_DONE=0
SUPABASE_STACK_EXPERIMENT_ID_A=''
SUPABASE_STACK_EXPERIMENT_ID_B=''
supabase_stack_experiment_cleanup
```

Recovery exited `0`, stopped/destroyed A, and removed both generated configs
and the private tools/runtime directories. The wrapper did not modify system
networking, processes belonging to other sessions, or the CLI's list format.
Changed-path/config protection and original exit-status preservation were
also covered by the 28 synthetic cleanup tests; those particular path faults
were not injected into running services. User provisioning/deletion faults
were exercised through the three new fake-network CLI regressions, not by
damaging a live Auth service.

Final cleanup verified that all eight runtime/tools directories from the four
attempts were absent and no process executable remained under their owned
paths. The four newly created detached baseline worktrees were verified clean
at `daa07b0` and removed. The retained experiment worktree, pre-existing
baseline worktree, primary checkout, and other sessions' resources were
preserved. Private downloaded tooling, credentials, status JSON, logs, and
fault-injection scripts were removed after recording these results; recovery
evidence is no longer needed because cleanup completed.

Recommendation: the corrected experiment now supplies the requested local
backend and cleanup/recovery evidence. Native concurrency still does not
establish container isolation. Local Auth/PostgREST/MCP checks do not establish
managed-project, production, browser/offline, physical-device, or
selection-history behavior. No publication is part of this validation.

### Earlier sandbox-only rerun attempt: 2026-10-15

At this earlier attempt, the corrected live rerun was **blocked**, and its
commit gate had not passed. The latest results above supersede that status.
Inspection found a clean experiment worktree on
`docs/supabase-local-stack-experiment`, based on `daa07b0`, with the experiment
already committed as `73ee091`, `c6609a7`, and `06364ae`. No commits were
created or rewritten during this attempt. The primary checkout was not changed.

The current host reports macOS `26.6.2` arm64, Node.js `26.8.1`, and
Homebrew `psql 17.11`. `command -v docker podman node supabase` found only
Node.js; neither container runtime nor a Supabase CLI was available on PATH.
The pinned download was attempted with:

```sh
curl -fL https://github.com/supabase/cli/releases/download/v2.120.0/supabase_darwin_arm64.tar.gz -o "$TOOLS/supabase.tar.gz"
```

It returned curl error `6`, `Could not resolve host: github.com`, before any
archive was downloaded. Fetching `https://supabase.com/changelog.md` with
`curl -fsSL` also returned error `6`, `Could not resolve host: supabase.com`.
No permission expansion or alternative installation was attempted. The pinned
checksum, CLI version, actual `--help` output, service versions, and actual
`stack list` recovery envelope could therefore not be verified in this run.
The official runtime and multiple-project documentation linked above was
accessible through the separate documentation browser; that access does not
provide the executable tooling needed for a local rerun. The changelog fetch
through that browser failed with an unsupported Markdown content type.

Observed checks in this attempt:

```sh
node --test scripts/schema-grants.node-test.mjs scripts/verify-rls-live.node-test.mjs scripts/supabase-stack-experiment.node-test.mjs scripts/supabase-stack-experiment-cleanup.node-test.mjs
node --test scripts/*.node-test.mjs
npm run docs:check
bash -n scripts/supabase-stack-experiment-cleanup.sh
node --check scripts/verify-rls-live.mjs
node --check scripts/verify-rls-live.node-test.mjs
node --check scripts/supabase-stack-experiment.mjs
node --check scripts/supabase-stack-experiment.node-test.mjs
node --check scripts/supabase-stack-experiment-cleanup.node-test.mjs
git diff --check daa07b0..HEAD
git diff --check
```

The focused run passed 54 tests; all standalone suites passed 63 tests with
zero failures or skips. Documentation checks passed their three tests and
checked 20 active files. All syntax and diff checks passed. No application
dependencies were installed. The 28 cleanup tests used synthetic fake-CLI
fixtures: they covered original failure preservation, attempts for remaining
resources, changed-path/config protection, and retained recovery evidence.
They do not establish compatibility with the pinned CLI's actual output.

Static review also found the then-unresolved cleanup-reporting issue in
`scripts/supabase-stack-experiment.mjs`: if provisioning throws after another
stack's users were created, the `finally` block attempts their deletion, but
any deletion failures appended to `failures` are not reported because the
pending exception skips the later aggregation. Preserve the provisioning
failure and user-cleanup failure together before accepting this harness.
The current fix and regression evidence above resolve this finding. The earlier
finding was established by control-flow inspection, not live fault
injection. The outer stack cleanup remains a separate recovery layer.

No live stack was started, no synthetic Auth user or database was created, no
generated Supabase config was written, and no additional worktree was created.
The run's temporary download/check directory was removed after validation;
test fixtures cleaned themselves up. Existing worktrees and other sessions'
resources were preserved. There is no incomplete live cleanup from this
attempt requiring retained recovery evidence. That report update was left
uncommitted at that time and is included in this record.

Strict rejection-code/FK assertions, mutation responses, confirmed probe
deletion, two-stack database isolation, destroy/recreate reproducibility,
database-only MCP discovery, and real CLI cleanup/recovery remain live gates.
Historical results below do not satisfy these corrected gates. Recommendation:
defer further commits until the pinned official tooling and services are
reachable within the authorized sandbox and the complete corrected procedure
and cleanup/recovery validation pass. Native concurrency would still not prove
container isolation; local Auth/PostgREST would not prove managed-project
behavior, and backend checks would not prove browser/offline behavior.

### Historical results before the corrected rerun

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
