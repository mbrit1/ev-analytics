# ADR 006: Tariff Snapshot Strategy

## Status
Accepted

## Context
Energy tariffs in Europe (and globally) are dynamic. Prices for AC and DC charging, as well as session fees, can change over time. If a user logs a charging session today and then updates their tariff prices next month, the historical session's cost should remain accurate based on the prices *at the time of the session*.

## Decision
We will use a **Snapshot Strategy** for tariff data on every charging session entry.

1.  **Denormalization:** When a `ChargingSession` is created, we will explicitly copy the current `ac_price_per_kwh`, `dc_price_per_kwh`, and `session_fee` from the selected `Tariff` into the `ChargingSession` record.
2.  **Calculated Cost:** The `total_cost` will be calculated at the moment of entry using these snapshotted values and stored as a static integer (cents).
3.  **UI Display:** The UI will prioritize the snapshotted values for historical views, ensuring that even if the original `Tariff` is deleted or modified, the historical record remains intact.

## Attributes Added to `ChargingSession`
- `applied_ac_price`: Integer (cents)
- `applied_dc_price`: Integer (cents)
- `applied_session_fee`: Integer (cents)
- `provider_name`: String (Denormalized for convenience)
- `tariff_name`: String (Denormalized for convenience)

## Consequences
- **Pros:**
    - Guaranteed data integrity for historical analytics.
    - Simplified analytics queries (no complex temporal joins).
    - Resilience against tariff deletion.
- **Cons:**
    - Slight increase in storage per session row (negligible for IndexedDB/PostgreSQL).
    - Requires logic in the session creation service to ensure snapshots are taken.
