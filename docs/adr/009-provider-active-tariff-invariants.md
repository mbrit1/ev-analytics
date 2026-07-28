# ADR 009: Provider Active-Tariff Invariants

## Status

Accepted

## Date

2026-07-28

## Context

Charging-plan versions are the MVP subscription timeline. They record a
provider tariff's price and validity interval, including the monthly base fee
needed by Overall Price. The application does not have a separate subscription
ledger, and provider-plan selections are session-derived rather than a complete
subscription history.

Without a provider-level paid-tariff rule, two differently named paid plans can
cover the same period. Overall Price cannot choose one of those fees safely.
The same ambiguity occurs when an ad-hoc session is entered for a billing
provider that already has an applicable saved tariff. The existing snapshot
contract must still retain historical ad-hoc data that was valid when entered.

## Decision

Charging-plan versions remain the MVP subscription timeline. For each user and
provider, at most one non-deleted charging-plan version with
`monthly_base_fee > 0` may cover a date at a time. Plans with a zero monthly
base fee may overlap each other and a paid plan. Intervals are half-open:
`[valid_from, valid_to)`, with a null end extending to infinity. Adjacent
intervals therefore do not overlap.

The local charging-plan service checks this invariant within its mutation
transaction, and the remote schema enforces the same provider-level paid-plan
exclusion. The existing non-deleted same-name version exclusion remains a
separate rule. The client must treat a remote constraint failure as a
non-retryable, user-resolvable outbox item rather than weakening the invariant.

When a newly created paid tariff overlaps exactly one earlier paid incumbent,
the UI offers an explicit forward switch. Confirmation closes that incumbent at
the candidate's `valid_from` and queues the incumbent update before the
candidate insert in the same local transaction. Multiple incumbents, a later
or equal-starting incumbent, and every other ambiguous case require manual
date repair. A paid-tariff switch does not automatically restore a previous
tariff later; restoration would make a subscription decision the application
cannot infer.

For a new or materially changed ad-hoc session, the billing-provider text must
not exactly identify a saved tariff that applies on the session date. Matching
uses `lower(trim(provider_name_snapshot))` against
`lower(trim(providers.name))`, within the same user, and any non-deleted plan
for that provider whose half-open interval contains the session's UTC date.
It does not use `provider_id`, CPO text, or fuzzy matching. Existing ad-hoc
sessions are grandfathered only when an edit keeps both that normalized billing
provider and the session timestamp unchanged; other edits recheck the rule.

Overall Price follows the split authority in [ADR 008](./008-overall-price-fixed-cost-authority.md).
It is unavailable for an inconsistency in qualifying paid history (or missing
referenced history), not merely because unrelated zero-fee definitions overlap.
It must never choose a paid tariff or fabricate a boundary to produce a
plausible partial result.

## Alternatives Considered

### Separate subscription ledger

Rejected for the MVP. It would introduce a parallel source of subscription
truth, plus a new local-first synchronization contract, migration, and repair
workflow. Charging-plan versions already provide the needed timeline once the
paid-provider invariant is explicit.

### Forbid every tariff overlap

Rejected because zero-fee definitions, including temporary pricing and other
non-recurring tariff versions, can legitimately overlap. Only concurrent
positive monthly fees create duplicate fixed-cost liability.

### Fuzzy-match ad-hoc billing providers

Rejected because fuzzy identity matching could falsely reject a legitimate
one-off billing provider or silently bind historical text to a saved provider.
Trimmed, case-insensitive equality is predictable, explainable, and does not
alter the stored snapshot.

### Automatically repair overlaps or restore a replaced tariff

Rejected because the application cannot infer the user's actual billing
contract. Automatic changes could invent subscription history or create a
second paid interval. Ambiguous history remains visible for manual correction.

## Consequences

- Local and remote validation protect the same paid-tariff invariant, including
  offline writes that synchronize later.
- A confirmed forward switch queues the closed incumbent update before the new
  candidate insert in one local transaction; ready outbox work is processed
  oldest-first.
- Ad-hoc validation gives field-specific billing-provider guidance. The CPO is
  optional context and never participates in tariff matching.
- Historical unchanged ad-hoc biller-and-timestamp edits remain possible even
  if later tariff data would otherwise conflict. Changing either identity or
  time requires the user to resolve the active saved tariff instead.
- Overall Price remains local-first and lifetime-scoped. It reports an
  unavailable result only when qualifying paid history is inconsistent or
  required referenced history is missing.
- Production data must be audited and, if needed, repaired through a separately
  approved operation before the remote constraint is rolled out to an existing
  project. The checked-in schema is a clean baseline, not that migration.

## Relationship to ADR 008

This ADR complements and does not supersede ADR 008. ADR 008 defines the split
authority for Overall Price: session snapshots own per-session spend, while
charging-plan history owns recurring fixed-cost intervals. This ADR makes the
paid portion of that charging-plan history unambiguous.
