# ADR 006: Charging Plan And Ad-Hoc Snapshot Strategy

## Status
Accepted

## Context
Charging prices in Europe (and globally) are dynamic. Users may either charge against a saved charging plan or enter an ad-hoc session from a one-off receipt/app quote. If a user logs a session today and later edits or deletes the underlying plan, the historical session cost must remain accurate for the original point in time.

## Decision
We will use a **Snapshot Strategy** for charging-session pricing.

1. **Charging-plan sessions:** When a `ChargingSession` uses `session_mode = plan`, we copy the effective plan price components and session fee into applied snapshot fields on the session row.
2. **Ad-hoc sessions:** When `session_mode = ad_hoc`, we store a full `ad_hoc_pricing` snapshot object on the session so no saved plan is required. In this mode, `charging_plan_name` remains `NULL` and the UI uses an `Ad-Hoc` fallback label.
3. **Calculated cost:** `total_cost` is calculated during entry from the selected source and stored as a static integer (cents).
4. **UI display:** History and analytics read session snapshots first, so historical rows remain stable even if plans are edited/deleted later.

## Snapshot Fields On `ChargingSession`
- `session_mode`: `'plan' | 'ad_hoc'`
- `tariff_plan_id` (nullable for ad-hoc)
- `charging_plan_name` (nullable for ad-hoc)
- `ad_hoc_pricing` (JSON snapshot for ad-hoc sessions)
- `applied_ac_price_per_kwh`: Integer (cents)
- `applied_dc_price_per_kwh`: Integer (cents)
- `applied_session_fee`: Integer (cents)
- `provider_name`: String (Denormalized for convenience)
- `charging_plan_name`: String (Denormalized plan label)

## Consequences
- **Pros:**
    - Guaranteed data integrity for historical analytics.
    - Simplified analytics queries (no complex temporal joins).
    - Supports both reusable plans and ad-hoc entries with a single session model.
- **Cons:**
    - Slight increase in storage per session row (negligible for IndexedDB/PostgreSQL).
    - Requires logic in the session creation service to ensure snapshots are taken.
