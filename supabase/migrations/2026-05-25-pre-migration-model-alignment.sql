-- Pre-migration model alignment for tariffs, charging sessions, and fixed tariff costs.
-- Idempotent where possible to support reruns in local/dev environments.

-- Tariffs
ALTER TABLE tariffs
  ADD COLUMN IF NOT EXISTS tariff_kind TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS roaming_ac_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS roaming_dc_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS monthly_base_fee INTEGER NULL;

ALTER TABLE tariffs
  ALTER COLUMN ac_price_per_kwh DROP NOT NULL,
  ALTER COLUMN dc_price_per_kwh DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'providers_user_id_id_key'
      AND conrelid = 'providers'::regclass
  ) THEN
    ALTER TABLE providers
      ADD CONSTRAINT providers_user_id_id_key UNIQUE (user_id, id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tariffs_user_id_id_key'
      AND conrelid = 'tariffs'::regclass
  ) THEN
    ALTER TABLE tariffs
      ADD CONSTRAINT tariffs_user_id_id_key UNIQUE (user_id, id);
  END IF;
END
$$;

-- Charging sessions
ALTER TABLE charging_sessions
  ADD COLUMN IF NOT EXISTS pricing_context TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS applied_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS applied_ac_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS applied_dc_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS applied_roaming_ac_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS applied_roaming_dc_price_per_kwh INTEGER NULL,
  ADD COLUMN IF NOT EXISTS applied_monthly_base_fee INTEGER NULL,
  ADD COLUMN IF NOT EXISTS applied_tariff_kind TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE charging_sessions
  ALTER COLUMN start_soc_percentage DROP NOT NULL,
  ALTER COLUMN end_soc_percentage DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'charging_sessions'
      AND column_name = 'applied_ac_price'
  ) THEN
    UPDATE charging_sessions
    SET
      applied_ac_price_per_kwh = COALESCE(applied_ac_price_per_kwh, applied_ac_price),
      applied_price_per_kwh = COALESCE(
        applied_price_per_kwh,
        CASE
          WHEN charging_type = 'AC' AND pricing_context IN ('standard', 'ad_hoc') THEN applied_ac_price
          ELSE NULL
        END
      )
    WHERE applied_ac_price IS NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'charging_sessions'
      AND column_name = 'applied_dc_price'
  ) THEN
    UPDATE charging_sessions
    SET
      applied_dc_price_per_kwh = COALESCE(applied_dc_price_per_kwh, applied_dc_price),
      applied_price_per_kwh = COALESCE(
        applied_price_per_kwh,
        CASE
          WHEN charging_type = 'DC' AND pricing_context IN ('standard', 'ad_hoc') THEN applied_dc_price
          ELSE NULL
        END
      )
    WHERE applied_dc_price IS NOT NULL;
  END IF;
END
$$;

ALTER TABLE charging_sessions
  DROP COLUMN IF EXISTS applied_ac_price,
  DROP COLUMN IF EXISTS applied_dc_price;

-- Fixed costs
CREATE TABLE IF NOT EXISTS fixed_tariff_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cost_date TIMESTAMPTZ NOT NULL,
  provider_id UUID NOT NULL,
  provider_name TEXT NOT NULL,
  tariff_id UUID NULL,
  tariff_name TEXT NULL,
  amount INTEGER NOT NULL,
  cost_type TEXT NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

ALTER TABLE fixed_tariff_costs
  DROP CONSTRAINT IF EXISTS fixed_tariff_costs_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS fixed_tariff_costs_tariff_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fixed_tariff_costs_user_provider_fkey'
      AND conrelid = 'fixed_tariff_costs'::regclass
  ) THEN
    ALTER TABLE fixed_tariff_costs
      ADD CONSTRAINT fixed_tariff_costs_user_provider_fkey
      FOREIGN KEY (user_id, provider_id)
      REFERENCES providers(user_id, id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fixed_tariff_costs_user_tariff_fkey'
      AND conrelid = 'fixed_tariff_costs'::regclass
  ) THEN
    ALTER TABLE fixed_tariff_costs
      ADD CONSTRAINT fixed_tariff_costs_user_tariff_fkey
      FOREIGN KEY (user_id, tariff_id)
      REFERENCES tariffs(user_id, id);
  END IF;
END
$$;

-- Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tariffs_tariff_kind_check'
      AND conrelid = 'tariffs'::regclass
  ) THEN
    ALTER TABLE tariffs
      ADD CONSTRAINT tariffs_tariff_kind_check
      CHECK (tariff_kind IN ('standard', 'subscription', 'ad_hoc'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tariffs_non_negative_prices_check'
      AND conrelid = 'tariffs'::regclass
  ) THEN
    ALTER TABLE tariffs
      ADD CONSTRAINT tariffs_non_negative_prices_check
      CHECK (
        (ac_price_per_kwh IS NULL OR ac_price_per_kwh >= 0) AND
        (dc_price_per_kwh IS NULL OR dc_price_per_kwh >= 0) AND
        (roaming_ac_price_per_kwh IS NULL OR roaming_ac_price_per_kwh >= 0) AND
        (roaming_dc_price_per_kwh IS NULL OR roaming_dc_price_per_kwh >= 0) AND
        session_fee >= 0 AND
        (monthly_base_fee IS NULL OR monthly_base_fee >= 0)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_pricing_context_check'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT sessions_pricing_context_check
      CHECK (pricing_context IN ('standard', 'roaming', 'ad_hoc'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_applied_tariff_kind_check'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT sessions_applied_tariff_kind_check
      CHECK (applied_tariff_kind IN ('standard', 'subscription', 'ad_hoc'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_optional_soc_range_check'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT sessions_optional_soc_range_check
      CHECK (
        (start_soc_percentage IS NULL OR (start_soc_percentage BETWEEN 0 AND 100)) AND
        (end_soc_percentage IS NULL OR (end_soc_percentage BETWEEN 0 AND 100))
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fixed_tariff_costs_amount_non_negative_check'
      AND conrelid = 'fixed_tariff_costs'::regclass
  ) THEN
    ALTER TABLE fixed_tariff_costs
      ADD CONSTRAINT fixed_tariff_costs_amount_non_negative_check
      CHECK (amount >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fixed_tariff_costs_cost_type_check'
      AND conrelid = 'fixed_tariff_costs'::regclass
  ) THEN
    ALTER TABLE fixed_tariff_costs
      ADD CONSTRAINT fixed_tariff_costs_cost_type_check
      CHECK (cost_type IN ('subscription', 'card_fee', 'activation_fee', 'roaming_fee', 'other'));
  END IF;
END
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS fixed_tariff_costs_user_cost_date_idx
  ON fixed_tariff_costs(user_id, cost_date);
CREATE INDEX IF NOT EXISTS fixed_tariff_costs_provider_id_idx
  ON fixed_tariff_costs(provider_id);
CREATE INDEX IF NOT EXISTS fixed_tariff_costs_tariff_id_idx
  ON fixed_tariff_costs(tariff_id);
CREATE INDEX IF NOT EXISTS fixed_tariff_costs_deleted_at_idx
  ON fixed_tariff_costs(deleted_at);

-- RLS and policies
ALTER TABLE fixed_tariff_costs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fixed_tariff_costs'
      AND policyname = 'Users can select own fixed tariff costs'
  ) THEN
    CREATE POLICY "Users can select own fixed tariff costs"
      ON fixed_tariff_costs FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fixed_tariff_costs'
      AND policyname = 'Users can insert own fixed tariff costs'
  ) THEN
    CREATE POLICY "Users can insert own fixed tariff costs"
      ON fixed_tariff_costs FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fixed_tariff_costs'
      AND policyname = 'Users can update own fixed tariff costs'
  ) THEN
    CREATE POLICY "Users can update own fixed tariff costs"
      ON fixed_tariff_costs FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fixed_tariff_costs'
      AND policyname = 'Users can delete own fixed tariff costs'
  ) THEN
    CREATE POLICY "Users can delete own fixed tariff costs"
      ON fixed_tariff_costs FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END
$$;
