-- Remove deprecated session location type field.
-- Safe to rerun in local/dev environments.

ALTER TABLE charging_sessions
  DROP COLUMN IF EXISTS location_type;
