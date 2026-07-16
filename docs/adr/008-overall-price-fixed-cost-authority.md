# ADR 008: Overall Price Fixed-Cost Data Authority

## Status

Accepted

## Date

2026-07-16

## Context

The Overall Price KPI needs one trustworthy lifetime price per
provider-billed kWh. Its numerator combines stored charging-session spend with
applicable recurring tariff fees.

[ADR 006](./006-tariff-snapshots.md) makes session snapshots authoritative for
historical session pricing. That remains sufficient for variable energy prices
and per-session fees, but a recurring monthly fee is not a per-session charge.
Calculating it requires two additional facts:

- whether a logical tariff was used in a local calendar month; and
- which calendar days and monthly fee versions were active in that month.

The existing data model offers three possible sources:

1. Session snapshots contain the plan and applied pricing at the time of a
   charge, but the monthly fee is repeated on every session and does not encode
   the subscription's complete active interval.
2. Provider-plan selections describe selections created from session activity,
   but they are session-derived and are not currently restored during initial
   synchronization. They are therefore not a complete subscription ledger.
3. Charging-plan versions contain the fixed-fee amount and validity interval.
   Sessions retain the exact `tariff_plan_id` used when their price was
   captured.

Inferring subscription boundaries from session dates would undercount tariff
days before or after a session and could hide overlapping paid tariffs. Adding
a new subscription ledger would require schema, synchronization, migration,
and repair decisions beyond this feature.

## Decision

Use a split authority for the Overall Price calculation:

1. Active, non-deleted charging sessions are authoritative for stored session
   spend and provider-billed energy, consistent with ADR 006.
2. A plan session's exact `tariff_plan_id` identifies the charging-plan version
   used by that session.
3. Sessions determine which logical tariff-months qualify for a recurring fee.
   Provider ID plus normalized tariff name provides the existing logical-tariff
   identity across promotions and successor versions.
4. Charging-plan version history is authoritative for recurring-fee amounts
   and active intervals within each qualifying tariff-month.
5. The calculation may read referenced soft-deleted charging-plan versions and
   the related historical versions needed to reconstruct that logical tariff's
   interval. User-facing tariff lists may continue to hide deleted records.
6. Provider-plan selections do not participate in qualification, interval
   reconstruction, or fee calculation.
7. The calculation runs from local Dexie-backed data and introduces no new
   backend endpoint or schema for this feature.
8. If referenced tariff history is missing, or different qualifying paid
   tariffs under one provider have conflicting active intervals, the KPI is
   unavailable. The calculation must not silently omit a fee or infer a switch
   boundary from session activity.

`docs/architecture.md` is the canonical current-state description of the
implemented Analytics data flow; this ADR retains the fixed-cost authority
decision and rationale.

## Relationship to ADR 006

This decision complements and does not supersede ADR 006.

- Session snapshots remain authoritative for the cost incurred by an
  individual charging session.
- Charging-plan history is consulted only for recurring fixed costs that cannot
  be derived safely by summing per-session snapshots.
- Editing a tariff must not rewrite stored session spend.

## Alternatives Considered

### Sum the monthly-fee snapshot from every session

Rejected because the same monthly fee is repeated across sessions. Summing it
would multiply the subscription fee by session count, while selecting one
arbitrary snapshot would still not establish the tariff's active days or
version transitions.

### Use provider-plan selections as the subscription timeline

Rejected for this feature because selections are created from session usage
rather than from an independently maintained billing contract, and initial
synchronization does not currently hydrate them. Treating them as authoritative
would make the KPI depend on incomplete local history.

### Infer tariff start and switch dates from charging sessions

Rejected because session activity does not define a subscription boundary. It
would omit billable days before the first session, shift changes to whichever
session happened next, and conceal overlapping paid tariffs instead of asking
the user to correct their dates.

### Add a dedicated subscription ledger or backend calculation

Rejected for the current feature because it would require a new schema,
offline-sync contract, migration, and user-facing repair path. A durable
subscription identity may become appropriate if the product later supports
multiple concurrent paid tariffs under one provider; that decision is tracked
in [GitHub issue #150](https://github.com/mbrit1/ev-analytics/issues/150).

## Consequences

- Overall Price remains local-first and available without a network round trip.
- Session pricing snapshots retain their established historical meaning.
- Analytics needs a narrow charging-plans read interface for complete relevant
  version history without changing the normal tariff-list filtering behavior.
- Referenced historical charging-plan rows cannot be purged merely because
  they are soft-deleted; they remain calculation dependencies.
- Missing history produces an explicit unavailable state instead of a partial
  but plausible price.
- The MVP depends on provider ID plus normalized tariff name as logical tariff
  identity. A future durable subscription identity would require a new ADR and
  migration strategy.
- Supporting multiple concurrent paid tariffs under one provider may require
  this decision to be superseded after the product and data-model decision in
  GitHub issue #150.
- `docs/architecture.md` must be updated when this behavior is implemented so
  current-state documentation reflects the resulting Analytics data flow.
