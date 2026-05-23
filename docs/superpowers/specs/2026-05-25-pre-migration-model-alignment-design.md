# Pre-Migration Model Alignment Design (EV Analytics PWA)

## 1. Objective

Prepare the existing app and database for a later one-time historical data migration from Apple Numbers.

This design covers only schema, app, sync, UI, and tests required so the future importer can write into a correct target model.

Out of scope:

- Parsing Apple Numbers files
- Import script implementation
- Running the one-time historical import

## 2. Confirmed Decisions

- Use only new session snapshot fields: `applied_ac_price_per_kwh` and `applied_dc_price_per_kwh`.
- `fixed_tariff_costs` must support Create/Edit/Delete in UI.
- Delete behavior for `fixed_tariff_costs` is soft delete only (`deleted_at`).
- Historical provider mapping uses `provider_name = "VW"` and `tariff_name = "Arbeit"`.
- Later import may use a hardcoded `user_id`.
- This package is migration-preparation only.
- Spec language is English.

## 3. Scope

### In Scope

- Supabase schema updates (`tariffs`, `sessions`, `fixed_tariff_costs`, constraints, RLS)
- TypeScript model updates
- Dexie schema/version migration and local data backfill defaults
- Sync outbox and sync engine support for `fixed_tariff_costs`
- Service-layer updates for tariff/session pricing logic and fixed cost CRUD
- Minimum UI updates for tariffs, sessions, fixed costs CRUD
- Automated test updates/additions

### Out of Scope

- Apple Numbers extraction/transformation logic
- Historical import execution
- Dashboard redesign beyond crash safety and model compatibility

## 4. Target Data Model

### 4.1 Tariff

Add:

- `tariff_kind`: `'standard' | 'subscription' | 'ad_hoc'`
- `roaming_ac_price_per_kwh?: number`
- `roaming_dc_price_per_kwh?: number`
- `monthly_base_fee?: number`

Keep/adjust:

- `ac_price_per_kwh?: number`
- `dc_price_per_kwh?: number`
- `session_fee: number`

Rules:

- Price fields are nullable/optional; `0` means truly free, not unknown.
- All monetary values remain integer cents.
- Non-negative validation applies to all prices/fees.

### 4.2 ChargingSession

Add:

- `pricing_context: 'standard' | 'roaming' | 'ad_hoc'`
- `applied_price_per_kwh?: number`
- `applied_ac_price_per_kwh?: number`
- `applied_dc_price_per_kwh?: number`
- `applied_roaming_ac_price_per_kwh?: number`
- `applied_roaming_dc_price_per_kwh?: number`
- `applied_monthly_base_fee?: number`
- `applied_tariff_kind: 'standard' | 'subscription' | 'ad_hoc'`

Adjust:

- `start_soc_percentage?` and `end_soc_percentage?` become optional.

Rules:

- Session snapshots remain mandatory behavior for historical correctness.
- Monthly base fee is snapshotted for traceability, but not charged per session by default.

### 4.3 FixedTariffCost (new entity)

Fields:

- `id`, `user_id`, `cost_date`
- `provider_id`, `provider_name`
- `tariff_id?`, `tariff_name?`
- `amount` (integer cents)
- `cost_type: 'subscription' | 'card_fee' | 'activation_fee' | 'roaming_fee' | 'other'`
- `notes?`, timestamps, `deleted_at?`

Purpose:

- Store non-session charging-related costs (e.g., monthly plan fee, card fee) separately from kWh sessions.

## 5. Supabase Design

### 5.1 `tariffs` changes

- Add `tariff_kind`, roaming price columns, `monthly_base_fee`.
- Make `ac_price_per_kwh` and `dc_price_per_kwh` nullable.
- Add check constraints for enum values and non-negative prices/fees.

### 5.2 `sessions` changes

- Add `pricing_context` and all new snapshot columns.
- Add `applied_tariff_kind`.
- Make SoC columns nullable.
- Add check constraints for pricing context, tariff kind, and optional SoC range.

### 5.3 `fixed_tariff_costs` table

- Create table with constraints and standard metadata fields.
- Add indexes for user/date/provider/tariff/deleted filtering.
- Enable RLS with owner-only policies aligned with private single-user posture.

### 5.4 Migration safety requirements

- Use `if not exists` where possible.
- Use deterministic constraint names; avoid duplicates on re-run.
- Keep migration scripts idempotent for local/dev repetition.

## 6. Dexie + Offline-First Design

### 6.1 Dexie schema/version

- Bump Dexie version.
- Extend `tariffs` and `sessions` stores with new indexed fields.
- Add `fixed_tariff_costs` store.
- Extend outbox table-name union to include `fixed_tariff_costs`.

### 6.2 Local upgrade behavior

For existing local records:

- `tariff_kind ??= 'standard'`
- `pricing_context ??= 'standard'`
- `applied_tariff_kind ??= 'standard'`
- Initialize `applied_price_per_kwh` from new `*_per_kwh` by charging type when possible.

No legacy `applied_ac_price` / `applied_dc_price` compatibility layer is retained in final state.

### 6.3 Write path invariants

- Normal app writes remain local-first (Dexie).
- Every mutating write generates an outbox entry transactionally.
- Replay order and retry metadata behavior remain unchanged.

## 7. Service-Layer Design

### 7.1 Tariff service

Responsibilities:

- CRUD and validation for new tariff fields.
- Enforce enum validity and non-negative amounts.
- Require at least one meaningful pricing/fee value across standard, roaming, base fee, session fee.

### 7.2 Session service

Responsibilities:

- Resolve applied per-kWh price from `charging_type + pricing_context`.
- Fail fast when chosen context has no matching price.
- Snapshot all relevant tariff fields into session.
- Keep SoC optional with no fake `0%` substitution.
- Compute `total_cost` for normal app entry as:
  - `kwh_billed * applied_price_per_kwh + applied_session_fee`

Note:

- `applied_monthly_base_fee` is snapshotted but monthly fee is not auto-distributed into each session.

### 7.3 FixedTariffCost service

New service (e.g. `src/features/tariffs/services/fixedTariffCostService.ts`) with:

- `createFixedTariffCost`
- `updateFixedTariffCost`
- `softDeleteFixedTariffCost`
- Optional query helper by date range

Behavior:

- Dexie write + outbox write in one transaction.
- Validation of amount and `cost_type`.

## 8. Sync Design

### 8.1 Outbox type

Extend `table_name` union to include `fixed_tariff_costs`.

### 8.2 Sync engine

Add replay support for `fixed_tariff_costs` actions:

- Insert
- Update
- Soft delete (update `deleted_at`)

Requirements:

- Preserve oldest-first replay behavior.
- Keep retry metadata (`retry_count`, `last_error`, `last_attempt_at`, `next_attempt_at`) consistent with existing tables.
- Keep operations idempotent/safe on retries.

## 9. UI Minimum for Migration-Readiness

### 9.1 Tariff UI

- Edit/display standard AC/DC prices
- Edit/display optional roaming AC/DC prices
- Edit/display tariff kind
- Edit/display monthly base fee

### 9.2 Session UI

- SoC fields optional
- Pricing context selectable (`standard`, `roaming`, `ad_hoc`)
- Price resolution reflects selected context/type
- Missing SoC renders as unknown/empty, never `0%`

### 9.3 Fixed costs UI

- List fixed tariff costs
- Create, edit, soft-delete entries
- Show amount/date/provider/tariff/type/notes

## 10. Analytics Compatibility

- Keep session cost and fixed-cost channels separate.
- Existing analytics must not crash when new nullable fields exist.
- €/kWh metrics must exclude fixed costs unless explicitly modeled later.

## 11. Testing Strategy

### 11.1 Unit tests

- Tariff validation with optional prices
- Non-negative enforcement
- Session pricing resolution across contexts
- Error on missing roaming/standard price for selected context
- Optional SoC acceptance
- FixedTariffCost validation

### 11.2 Dexie tests

- Schema upgrade default backfill behavior
- Read/write for `fixed_tariff_costs`
- Outbox support for `fixed_tariff_costs`

### 11.3 Sync tests

- Insert/update/soft-delete replay for `fixed_tariff_costs`
- Retry metadata regression coverage

### 11.4 Regression tests

- Existing provider/tariff/session flows remain green
- Existing outbox/sync tests remain green

## 12. Risks and Mitigations

- Risk: Constraint-name collisions in repeated local migrations.
  - Mitigation: deterministic names + existence guards where possible.

- Risk: Nullable SoC/price fields break assumptions in UI/analytics.
  - Mitigation: explicit null handling tests and UI rendering checks.

- Risk: Sync edge cases for newly added table.
  - Mitigation: mirror existing sync patterns and add retry/idempotency tests.

## 13. Acceptance Criteria

This package is done when:

- Supabase supports the new tariff/session model and `fixed_tariff_costs`.
- Dexie and TypeScript models are aligned.
- Session snapshots support standard/roaming/ad-hoc context.
- SoC is optional end-to-end.
- Fixed tariff costs support local CRUD + outbox + sync (soft delete only).
- UI supports required pre-migration editing/visibility.
- Test suite covers new logic and key regressions.
- No Apple Numbers import logic was implemented.
