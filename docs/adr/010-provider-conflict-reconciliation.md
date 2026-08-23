# ADR 010: Provider-Conflict Reconciliation

## Status

Accepted for phased implementation; current production behavior remains ADR 005.

## Date

2026-08-23; amended 2026-08-26

## Context

An offline-created provider can fail its ordinary Supabase upsert when a distinct
active provider already exists remotely with the same normalized name. The
terminal outbox item must remain diagnostic until the user explicitly recovers
it. Automatic rebinding is unsafe because the staged provider can be referenced
by charging plans, provider-plan selections, plan-mode sessions, and queued
mutations. An active sync pass or a stale local writer could otherwise upload or
recreate a staged reference while reconciliation is running.

The approved contract is [the provider-conflict reconciliation
specification](../specs/issue-177-provider-conflict-reconciliation.md). It
requires authenticated RLS-protected reads and explicitly forbids Supabase
schema, RLS, RPC, migration, service-role, or production-data changes.

The original terminal-outbox contract retained only user-facing `last_error`
copy. That is insufficient to recognize recovery after reload without treating
display text as control flow: the live Supabase response's PostgreSQL code and
constraint are otherwise discarded at the sync boundary.

## Decision

The offline-sync feature will own an explicit, user-triggered two-step recovery
flow:

1. **Prepare** validates the terminal provider-insert conflict, reads the full
   owner-scoped local graph, performs fresh authenticated canonical-provider
   preflight, and evaluates the combined tariff timeline without mutation.
2. **Confirm** re-authenticates, refreshes the preflight while sync is quiesced,
   rejects stale review state, and atomically rewrites the safe local graph in
   one Dexie transaction.

The existing local `sync_outbox` row gains an optional, non-indexed
`failure_kind: 'provider-name-conflict'` data property. No new Dexie version,
migration, index, table, dependency, or remote change is introduced. The sync
boundary assigns the discriminator only when the live Supabase error has both
PostgreSQL code `23505` and constraint
`providers_user_name_active_unique`, then persists it with the existing safe
terminal message and retry metadata. The shared typed predicate requires the
discriminator plus the terminal provider-insert state, valid owner-scoped
payload, and matching staged provider; `last_error` is diagnostic copy only.

Every remote result is applied only after a short local transaction re-reads
and fully matches the attempted outbox row by ID, table, action, timestamp, and
payload. Stale results are discarded. Recognized conflicts set the discriminator;
all other failures, repair/reset, or payload/action replacement clear it; and
success deletes only a still-matching row. Existing unmarked terminal rows fail
closed as generic after reload and are quarantined from automatic resend; their
dependent queue rows remain blocked. A separate provider `UPDATE` cannot retire
or supersede the retained terminal `INSERT`. Any user-visible legacy retry,
reclassification, or supersession workflow requires separate approval.
`last_attempt_at` remains the attempt-start timestamp.

Raw PostgreSQL metadata is used only for immediate classification. It is never
stored in Dexie, exposed through UI status, or emitted by the known-conflict
logging path. Browser networking necessarily receives the response, but the app
does not retain or display its raw message, details, hint, or constraint data.

The transaction covers providers, charging plans, provider-plan selections,
sessions, the outbox, and local reconciliation evidence. It upserts the
canonical provider, preserves all stable row IDs and session snapshots, rebuilds
affected non-provider payloads from the current rows, removes only the eligible
terminal staged-provider item, and removes the staged provider last. Any error
rolls back the complete local change. Blocked, cancelled, retryable, and stale
paths retain the staged provider and its terminal outbox item.

Reconciliation shares a database-scoped, cross-runtime exclusion boundary with
every v6-or-newer outbox pass and `initialSync` write cycle. It waits for local
and earlier lock-participating passes, holds exclusivity through confirm and the
transaction, and resumes coalesced normal sync in `finally`. A pre-v6 pass,
stale bundle, or remote effect begun before lock participation is explicitly
unsupported mixed-version behavior: it cannot be fenced by new local code.
Every local plan, selection, and plan-mode session mutation validates its
referenced, same-user provider inside its Dexie transaction so a stale writer
cannot restore a staged reference.

The local database version is incremented so Dexie's default `versionchange`
handling closes already-open older connections. A stale bundle can later reopen
the database under Dexie's normal auto-open behavior, so this is explicitly an
unsupported downgrade rather than a schema-level rejection guarantee. The new
local-only `provider_reconciliations` store records the completed owner, staged
and canonical IDs, exact affected row/outbox identities, canonical reviewed
serialization, and completion time. It is written in the same transaction and
is never an outbox mutation or Supabase record. On reload, the application
verifies the evidence together with current graph postconditions before
returning `already-reconciled`. It is completion proof only: unresolved,
cancelled, blocked, retryable, and stale failures never write it.

Outbox replay will derive parent dependencies from durable queue state: plan
mutations wait for provider inserts; selection mutations wait for plan inserts;
and plan-mode sessions wait for their plan and, when present, selection inserts.
Terminal parents continue to block descendants while unrelated ready work may
continue. This is a forward-only local runtime floor: a rollback may hide the
recovery UI but must preserve the upgraded database and the safety guards.

## Alternatives Considered

### Automatically rebind during ordinary outbox replay

Rejected. The error message is not trusted identity data, and background replay
cannot safely present tariff ambiguity, obtain confirmation, or protect the
complete local graph.

### Rename or merge tariff history automatically

Rejected. The application cannot infer the user's tariff dates or intended
logical identity. Exact duplicates and overlapping histories remain blocked for
user repair without deleting either stable ID.

### Remote transaction, RPC, or schema change

Rejected. The user-visible recovery can converge through existing idempotent
outbox upserts, while current authenticated RLS reads remain the least-privilege
remote boundary. The approved scope has no remote migration or production-data
operation.

### In-memory completion marker or runtime-only lock

Rejected. Reloads and other tabs would lose the proof or bypass the lock. The
Dexie version barrier, durable evidence, and shared database-scoped exclusion
are required for safe retry and reload behavior.

## Consequences

- Reconciliation is explicit, owner-scoped, RLS-protected, and does not expose
  cross-user lookup, service credentials, or direct SQL.
- The database upgrade is intentionally incompatible with older application
  runtimes; recovery requires forward repair rather than downgrade.
- Local graph rewrites are atomic and idempotency is provable after reload, but
  remote convergence remains eventual through the existing outbox.
- Ambiguous tariffs, malformed references, authentication changes, remote
  mismatches, and stale confirmations fail closed with typed user-safe guidance.
- ADR 005 remains the current outbox decision until the implementation lands;
  after the feature ships, it must be updated to describe the implemented
  reconciliation, cross-runtime exclusion, and descendant replay rules.
