-- Adds provider/tariff snapshot names to charging_sessions so offline sync
-- payload matches remote schema.

ALTER TABLE charging_sessions
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS tariff_name TEXT;

-- Backfill existing rows from foreign-key relations where possible.
UPDATE charging_sessions cs
SET provider_name = p.name
FROM providers p
WHERE cs.provider_id = p.id
  AND cs.provider_name IS NULL;

UPDATE charging_sessions cs
SET tariff_name = t.tariff_name
FROM tariffs t
WHERE cs.tariff_id = t.id
  AND cs.tariff_name IS NULL;

-- Enforce snapshot presence after backfill.
ALTER TABLE charging_sessions
  ALTER COLUMN provider_name SET NOT NULL,
  ALTER COLUMN tariff_name SET NOT NULL;

