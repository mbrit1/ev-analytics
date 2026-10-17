# ADR 012: Provider Plan Selection History Reconstruction

## Status

Accepted

## Date

2026-10-02

## Implementation State

Partially implemented. PR [#271](https://github.com/mbrit1/ev-analytics/pull/271)
supplies deterministic local selection history and transactional session
correctness on main, including unchanged-pricing historical edits. The current
[local-history boundary](../architecture.md#local-provider-plan-selection-history)
describes those guarantees. Selection hydration, guarded remote replay and
same-user cross-device convergence remain pending; local correctness does not
complete Issue #124.

This ADR records the accepted product and data-authority decision. It does not
specify a remote schema, hydration merge algorithm, recovery protocol or SQL API.
The acceptance criteria below bound the complete continuity requirement; they
are not a claim that remote continuity is implemented.

## Context

Issue [#124](https://github.com/mbrit1/ev-analytics/issues/124) concerns the
continuity of provider-plan selections across devices and reinstalls. The
current initial sync pulls providers, charging plans, and sessions, but omits
`provider_plan_selections`. Although selection rows are replayed through the
outbox, a device without their history can construct a different local
selection timeline.

For example, device A leaves selection S1 open. Fresh device B creates
selection S2 without seeing S1, even when switching to another plan, so S1
remains open remotely. Likewise, reassignment or deletion currently affects
only linked selections known to that device. This can leave same-user history
inconsistent after devices reconnect.

Sessions retain immutable pricing and display snapshots. Those snapshots
preserve the historical values used for a session, including when a session is
later edited without changing its price. Selection history supports
reconstruction of which plan was selected; it is not the authority for a
session's historical price or display. See [ADR 006](./006-tariff-snapshots.md).

Selections are created from session activity. They do not represent an
independently maintained subscription or fee timeline. In particular, they
must not be used to replace the charging-plan history and session-derived
semantics established by [ADR 008](./008-overall-price-fixed-cost-authority.md)
and [ADR 009](./009-provider-active-tariff-invariants.md).

## Decision

Require eventual continuity of provider-plan selection history for the same
authenticated user across that user's devices and reinstalls. Restoring
selection history must allow a device to reuse the appropriate selection and
to close the correct preceding selection when the user switches plans.

Keep session snapshots authoritative for historical pricing and display,
including unchanged-pricing edits. Selection history remains session-derived;
it does not become a subscription ledger or a source for recurring-fee
qualification or reconstruction. Tariff retirement remains derived from
charging-plan validity; it does not modify sessions or selection history.

The implementation must preserve the repository's local-first contract:
offline selection writes are atomic with their outbox entries, and remote
history is reconciled without losing pending local selection mutations or
tombstones. Providers and plans must be available before selections are
hydrated, and selections before sessions. History restoration must remain
owner-scoped and must not leak data across authentication changes.

This decision does not define a general multi-writer system, new user-facing
features, or UI. The exact schema and deterministic interval lookup, overlap,
concurrency, and reconnect-resolution rules require explicit specification and
tests. The local interval and transaction guarantees implemented by PR #271 do
not settle the remote contract; hydration alone is incomplete.

Existing duplicate or overlapping selection history may require repair. Any
repair must preserve IDs referenced by sessions and snapshots; it must not
silently rewrite those references or historical snapshot values. Provider
reassignment and plan deletion must remain consistent across reconstructed
history.

## Alternatives Considered

### Keep selections local to each device

Rejected because a fresh or reinstated device cannot reconstruct the same
selection history, and local-only reassignment or deletion can leave remote
history open or stale.

### Treat selections as the subscription or fee timeline

Rejected because selections are session-derived and do not record a complete
billing contract. ADR 008 and ADR 009 retain their existing authority and
semantics.

### Infer correct history from session snapshots alone

Rejected because snapshots preserve historical pricing and display, but do
not replace the selection history needed to reuse a selection or identify the
preceding selection during a switch.

### Add a general multi-writer merge system

Rejected for this issue. The accepted requirement is same-user selection
continuity; broader merge behavior and new UI are outside scope. The bounded
conflict and retry rules must still be deterministic before implementation.

## Consequences

- Same-user devices are expected eventually to converge on provider-plan
  selection history, subject to explicit, deterministic handling of concurrent
  edits and stale pulls.
- Session snapshots remain the durable authority for historical session
  prices and display, and the existing session-derived fee semantics and
  charging-plan-validity-based tariff retirement remain in force.
- Initial hydration and outbox replay require a selection-history contract
  that respects ownership, dependencies, local pending work, and tombstones.
- ADR 005 and `docs/architecture.md` continue to describe current behavior;
  they link to this accepted decision and distinguish implemented local
  guarantees from pending remote continuity.

## Acceptance Criteria

Before the complete continuity implementation is accepted, it must meet all of
the following. Local guarantees supplied by PR #271 satisfy only part of this
boundary:

- Define explicit selection columns and normalization rules, including UTC
  dates and the treatment of absent optional values.
- Enforce owner-scoped RLS and prove that authentication changes cannot expose
  one user's selection history to another user.
- Hydrate dependencies in order: providers and plans, then selections, then
  sessions. Track pull readiness and failures, retry failures, and retain
  domain writes and outbox entries on failed or partial hydration.
- Preserve pending local selection inserts, updates, deletes, and tombstones
  when pulls contain stale remote rows. Keep offline domain writes and outbox
  entries atomic; replay must be idempotent and respect dependencies.
- On a fresh device, reuse the appropriate existing selection. When a user
  switches plans, close the correct preceding selection without leaving a
  second open interval.
- Specify and test deterministic interval lookup, overlap behavior, and
  concurrent-edit and reconnect resolution before implementation. A successful
  pull by itself does not satisfy this criterion.
- Repair duplicate or overlapping existing selections without silently
  changing IDs referenced by sessions or rewriting immutable snapshots.
- Keep provider reassignment and plan deletion consistent across reconstructed
  linked history, and retain charging-plan-validity-based retirement without
  modifying sessions or selection history.
- Verify regressions for fresh-device existing-history read/edit/reuse/switch;
  two devices with offline reconnect and overlapping changes; stale pulls with
  pending updates and deletes; authentication change, partial pull, rollback,
  and repeated replay; linked tariff changes; and snapshot and fee authority.
