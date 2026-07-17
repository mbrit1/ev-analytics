# ADR 006: Charging Plan And Ad-Hoc Snapshot Strategy

## Status

Accepted

## Date

2026-05-16

## Last updated

2026-07-17

## Context
Charging prices in Europe (and globally) are dynamic. Users may either charge against a saved charging plan or enter an ad-hoc session from a one-off receipt/app quote. If a user logs a session today and later edits or deletes the underlying plan, the historical session cost must remain accurate for the original point in time. For an ad-hoc session, the company or app that bills the user may differ from the charging-station operator and may have no saved tariff, so history must preserve both roles without adding tariff configuration.

## Decision
We will use a **Snapshot Strategy** for charging-session pricing.

1. **Charging-plan sessions:** When a `ChargingSession` uses `session_mode = plan`, we store the selected plan and selection identifiers, provider/plan name snapshots, a compact `price_snapshot`, and the applied price components on the session row.
2. **Ad-hoc sessions:** When `session_mode = ad_hoc`, the required `provider_name_snapshot` stores the billing provider—the company or app that charged the user—even when that provider has no saved tariff. The saved-provider relationship (`provider_id`), `tariff_plan_id`, and `plan_selection_id` remain `NULL` or absent. The `ad_hoc_pricing` object stores the one-off pricing snapshot; `charging_plan_name_snapshot` may retain an ad-hoc display label but is not provider identity.
3. **Optional operator snapshot:** `ad_hoc_pricing.cpoName` stores the charging-station operator when known. It is independent from the billing-provider snapshot and must not replace or populate `provider_name_snapshot`; the operator may be unknown or may differ from the company that billed the session.
4. **Calculated cost:** `total_cost` is calculated during entry from the selected source and stored as a static integer (cents).
5. **UI display:** History and analytics read session snapshots first, so historical rows remain stable even if plans are edited/deleted later.

## Snapshot Fields On `ChargingSession`
- `session_mode`: `'plan' | 'ad_hoc'`
- `provider_id` (required for plan sessions; `NULL` for ad-hoc sessions)
- `tariff_plan_id` (nullable for ad-hoc)
- `plan_selection_id` (nullable for ad-hoc)
- `provider_name_snapshot` (selected saved-provider name for plan sessions; required billing-provider text for ad-hoc sessions)
- `charging_plan_name_snapshot` (selected plan name or an ad-hoc display label; not provider identity)
- `price_snapshot` (JSON snapshot of the selected effective price)
- `ad_hoc_pricing` (JSON snapshot for ad-hoc sessions, including optional `cpoName` operator context)
- `applied_price_per_kwh`: Integer (cents)
- `applied_ac_price_per_kwh`: Integer (cents)
- `applied_dc_price_per_kwh`: Integer (cents)
- `applied_roaming_ac_price_per_kwh`: Integer (cents)
- `applied_roaming_dc_price_per_kwh`: Integer (cents)
- `applied_monthly_base_fee`: Integer (cents)
- `applied_session_fee`: Integer (cents)

## Consequences
- **Pros:**
    - Guaranteed data integrity for historical analytics.
    - Simplified analytics queries (no complex temporal joins).
    - Supports both reusable plans and ad-hoc entries with a single session model.
    - Keeps one-off billing providers out of tariff configuration while preserving billing and operator identities for future analytics.
- **Cons:**
    - Slight increase in storage per session row (negligible for IndexedDB/PostgreSQL).
    - Requires logic in the session creation service to ensure snapshots are taken.
    - Free-text ad-hoc identities are historical snapshots rather than normalized provider relationships, so later analytics must define its own grouping rules without rewriting stored values.
