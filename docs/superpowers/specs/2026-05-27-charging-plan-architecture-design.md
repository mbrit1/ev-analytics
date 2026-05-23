# Charging Plan Architecture Design

## Summary
Refactor the current Tariffs feature into an internal `ChargingPlan` domain while keeping the user-facing navigation label “Tariffs”. Persist plans in renamed `charging_plans` stores/tables, remove `planType`/`tariff_kind`, remove detached fixed tariff costs, and support v1 session pricing sources: `chargingPlan` and `adHoc`.

Assumptions locked:
- Production has no data, so breaking Supabase/Dexie migrations are acceptable.
- User-facing labels may still say “Tariff” where that matches EV user language.
- Internal TypeScript, services, stores, sync routing, and Supabase tables should use `ChargingPlan`.
- `home` and `manual` pricing sources are out of scope for v1.

## Public API / Type Changes
- Replace internal `Tariff` with `ChargingPlan`.
- Add nested plan fields:
  - `validity: { from: Date; to?: Date | null }`
  - `prices.domestic.ac/dc`
  - `prices.roaming?.ac/dc`
  - `fees.subscriptionMonthly`, `activationOneTime`, `sessionFixed`, `cardFee`, `other[]`
  - optional `affiliation` and `notes`
- Replace session pricing context with:
  - `pricing_source: 'chargingPlan' | 'adHoc'`
  - `charging_plan_id?: string | null`
  - `charging_plan_name?: string | null`
  - `ad_hoc_pricing?: AdHocPricingSnapshot | null`
- Keep historical session snapshots for applied prices/fees, but rename tariff-specific snapshot fields to charging-plan terminology.
- Remove `FixedTariffCost` from app APIs, Dexie, Supabase schema, sync outbox table union, UI, and tests.

## Implementation Changes
- Create/rename the domain feature to `src/features/charging-plans`, exporting hooks/services/components from its `index.ts`; keep the visible page title/navigation as “Tariffs”.
- Update Dexie to version 4 with `charging_plans` instead of `tariffs`, remove `fixed_tariff_costs`, and use a clear upgrade path that drops obsolete local stores because no production data exists.
- Replace Supabase schema/migration with `charging_plans`; update `charging_sessions` foreign keys and snapshot columns; drop `fixed_tariff_costs`; preserve default-deny RLS/authenticated single-user policies.
- Update sync engine:
  - outbox table names become `providers | charging_plans | sessions`
  - `charging_plans` syncs to Supabase `charging_plans`
  - initial sync hydrates providers, charging plans, and sessions only.
- Update charging plan service validation:
  - no `tariff_kind`
  - all money is integer cents and non-negative
  - at least one domestic/roaming price or fee is present
  - `fees.other[]` entries require `label`, `amount`, and `notes`
  - `validity.from` is required, `validity.to` is nullable.
- Update session preparation:
  - for `pricing_source = 'chargingPlan'`, require `charging_plan_id`, provider, and selected plan; use domestic or roaming prices from the plan and add `fees.sessionFixed`.
  - for `pricing_source = 'adHoc'`, require `ad_hoc_pricing`; compute from `pricePerKwh`, optional per-minute/session/other fees where provided; do not require a saved plan.
  - ignore `ad_hoc_pricing` for plan sessions and ignore `charging_plan_id` for ad-hoc sessions.
- Redesign the Tariffs page cards:
  - primary: plan/provider name and domestic AC/DC prices with tabular numbers
  - secondary: roaming availability/prices
  - fee badges/rows: subscription, activation, session, card, other fees
  - remove the “Fixed Tariff Costs” section entirely.
- Refactor the plan form into grouped slabs:
  - Identity: plan name, provider, valid from/to
  - Charging Prices: domestic AC/DC, visually dominant
  - Roaming Prices: secondary
  - Additional Fees: subscription, activation, session, card
  - Advanced: collapsible other fees, affiliation, notes.
- Update session form:
  - add pricing source selector with `Charging Plan` and `Ad-Hoc`
  - show provider/plan/domestic-roaming controls only for charging-plan sessions
  - show ad-hoc pricing slab for ad-hoc sessions: CPO/operator, payment method, price per kWh, price per minute, session fee, price source, notes, other fees.
- Update mock seed data, MSW handlers, ADR 006 wording, and imports to use charging-plan terminology internally.

## Test Plan
- Unit tests for charging plan service:
  - saves plan and queues `charging_plans` outbox item
  - rejects negative/non-integer cents
  - rejects missing meaningful price/fee
  - rejects `other` fees without notes
  - soft-deletes plans and queues delete payloads.
- Session service tests:
  - charging-plan domestic AC/DC cost calculation
  - charging-plan roaming AC/DC cost calculation
  - ad-hoc cost calculation with kWh, session fee, and other fees
  - missing plan for `chargingPlan` throws
  - missing ad-hoc pricing for `adHoc` throws
  - snapshots remain stable.
- Sync tests:
  - uploads `charging_plans` to Supabase `charging_plans`
  - no longer syncs `fixed_tariff_costs`
  - initial sync hydrates providers/plans/sessions
  - retry metadata still works.
- UI tests:
  - Tariffs page no longer renders fixed-cost workflow
  - cards show domestic prices first and optional fee/roaming details conditionally
  - plan form validates grouped required fields
  - session form switches between Charging Plan and Ad-Hoc flows.
- Final verification:
  - `npm run lint`
  - `npm run test -- --run`
  - `npm run build`
  - `npm run build:analyze` because this is a broad UI/runtime model change.

## Risks / Notes
- This invalidates the previous pre-migration model alignment design that introduced `tariff_kind` and `fixed_tariff_costs`; implementation should update or supersede that documentation.
- Because persisted table names change, local IndexedDB users may need a one-time reset/drop behavior during Dexie migration.
- `pricingSource: 'home' | 'manual'` should be deferred until the session logging flow explicitly needs those modes.
