-- Charging-plan architecture migration.
-- Idempotent where practical to support reruns in local/dev.

-- 1) Create charging_plans table if it does not exist yet.
CREATE TABLE IF NOT EXISTS charging_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL,
  name TEXT NOT NULL,
  validity JSONB NOT NULL,
  prices JSONB NOT NULL,
  fees JSONB NOT NULL DEFAULT '{}'::jsonb,
  affiliation JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charging_plans_user_provider_fkey'
      AND conrelid = 'charging_plans'::regclass
  ) THEN
    ALTER TABLE charging_plans
      ADD CONSTRAINT charging_plans_user_provider_fkey
      FOREIGN KEY (user_id, provider_id) REFERENCES providers(user_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charging_plans_user_id_id_key'
      AND conrelid = 'charging_plans'::regclass
  ) THEN
    ALTER TABLE charging_plans
      ADD CONSTRAINT charging_plans_user_id_id_key UNIQUE (user_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charging_plans_validity_object_check'
      AND conrelid = 'charging_plans'::regclass
  ) THEN
    ALTER TABLE charging_plans
      ADD CONSTRAINT charging_plans_validity_object_check
      CHECK (jsonb_typeof(validity) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charging_plans_prices_object_check'
      AND conrelid = 'charging_plans'::regclass
  ) THEN
    ALTER TABLE charging_plans
      ADD CONSTRAINT charging_plans_prices_object_check
      CHECK (jsonb_typeof(prices) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charging_plans_fees_object_check'
      AND conrelid = 'charging_plans'::regclass
  ) THEN
    ALTER TABLE charging_plans
      ADD CONSTRAINT charging_plans_fees_object_check
      CHECK (jsonb_typeof(fees) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charging_plans_affiliation_object_check'
      AND conrelid = 'charging_plans'::regclass
  ) THEN
    ALTER TABLE charging_plans
      ADD CONSTRAINT charging_plans_affiliation_object_check
      CHECK (affiliation IS NULL OR jsonb_typeof(affiliation) = 'object');
  END IF;
END
$$;

-- 2) Backfill charging_plans from legacy tariffs table where present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'tariffs'
  ) THEN
    INSERT INTO charging_plans (
      id,
      user_id,
      provider_id,
      name,
      validity,
      prices,
      fees,
      notes,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      t.id,
      t.user_id,
      t.provider_id,
      t.tariff_name,
      jsonb_build_object(
        'from', t.valid_from,
        'to', t.valid_to
      ),
      jsonb_strip_nulls(
        jsonb_build_object(
          'domestic', jsonb_strip_nulls(
            jsonb_build_object(
              'ac', t.ac_price_per_kwh,
              'dc', t.dc_price_per_kwh
            )
          ),
          'roaming', jsonb_strip_nulls(
            jsonb_build_object(
              'ac', t.roaming_ac_price_per_kwh,
              'dc', t.roaming_dc_price_per_kwh
            )
          )
        )
      ),
      jsonb_strip_nulls(
        jsonb_build_object(
          'sessionFixed', t.session_fee,
          'subscriptionMonthly', t.monthly_base_fee
        )
      ),
      NULL,
      t.created_at,
      t.updated_at,
      t.deleted_at
    FROM tariffs t
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

-- 3) Evolve charging_sessions for charging-plan + ad-hoc compatibility.
ALTER TABLE charging_sessions
  ADD COLUMN IF NOT EXISTS charging_plan_id UUID NULL,
  ADD COLUMN IF NOT EXISTS charging_plan_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS pricing_source TEXT NOT NULL DEFAULT 'chargingPlan',
  ADD COLUMN IF NOT EXISTS ad_hoc_pricing JSONB NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'charging_sessions'
      AND column_name = 'tariff_id'
  ) THEN
    UPDATE charging_sessions
    SET charging_plan_id = COALESCE(charging_plan_id, tariff_id)
    WHERE charging_plan_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'charging_sessions'
      AND column_name = 'tariff_name'
  ) THEN
    UPDATE charging_sessions
    SET charging_plan_name = COALESCE(charging_plan_name, tariff_name)
    WHERE charging_plan_name IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'charging_sessions'
      AND column_name = 'pricing_context'
  ) THEN
    UPDATE charging_sessions
    SET pricing_source = CASE
      WHEN pricing_context = 'ad_hoc' THEN 'adHoc'
      ELSE 'chargingPlan'
    END
    WHERE pricing_source = 'chargingPlan';
  END IF;
END
$$;

DO $$
BEGIN
  ALTER TABLE charging_sessions
    DROP CONSTRAINT IF EXISTS sessions_plan_requirement_check;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_user_charging_plan_fkey'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT sessions_user_charging_plan_fkey
      FOREIGN KEY (user_id, charging_plan_id) REFERENCES charging_plans(user_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_pricing_source_check'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT sessions_pricing_source_check
      CHECK (pricing_source IN ('chargingPlan', 'adHoc'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_ad_hoc_pricing_object_check'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT sessions_ad_hoc_pricing_object_check
      CHECK (ad_hoc_pricing IS NULL OR jsonb_typeof(ad_hoc_pricing) = 'object');
  END IF;

  ALTER TABLE charging_sessions
    ADD CONSTRAINT sessions_plan_requirement_check
    CHECK (
      (pricing_source = 'chargingPlan' AND charging_plan_id IS NOT NULL)
      OR (pricing_source = 'adHoc' AND ad_hoc_pricing IS NOT NULL)
    );
END
$$;

-- 4) Remove deprecated fixed_tariff_costs model.
DROP TABLE IF EXISTS fixed_tariff_costs;

-- 5) Keep authenticated/private RLS posture for charging_plans.
ALTER TABLE charging_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'charging_plans'
      AND policyname = 'Users can manage their own charging plans'
  ) THEN
    CREATE POLICY "Users can manage their own charging plans"
      ON charging_plans FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

-- Remove ad-hoc payment metadata now that ad-hoc sessions are always card-based.
UPDATE charging_sessions
SET ad_hoc_pricing = ad_hoc_pricing - 'paymentMethod'
WHERE ad_hoc_pricing ? 'paymentMethod';

-- Rename ad-hoc source field to the normalized enum-like key.
UPDATE charging_sessions
SET ad_hoc_pricing = (ad_hoc_pricing - 'priceSource') || jsonb_build_object(
  'priceCapturedFrom',
  CASE LOWER(COALESCE(ad_hoc_pricing->>'priceSource', ''))
    WHEN 'station display' THEN 'stationDisplay'
    WHEN 'on-site display' THEN 'stationDisplay'
    WHEN 'qr page' THEN 'qrPage'
    WHEN 'receipt' THEN 'receipt'
    WHEN 'manual' THEN 'manual'
    ELSE 'unknown'
  END
)
WHERE ad_hoc_pricing ? 'priceSource';

-- Remove unsupported billed-duration metadata from ad-hoc snapshots.
UPDATE charging_sessions
SET ad_hoc_pricing = ad_hoc_pricing - 'minutesBilled'
WHERE ad_hoc_pricing ? 'minutesBilled';

-- 6) Cleanup legacy artifacts once backfill is complete.
ALTER TABLE charging_sessions
  DROP COLUMN IF EXISTS tariff_id,
  DROP COLUMN IF EXISTS tariff_name,
  DROP COLUMN IF EXISTS pricing_context,
  DROP COLUMN IF EXISTS applied_tariff_kind;

DROP TABLE IF EXISTS tariffs;

CREATE INDEX IF NOT EXISTS idx_charging_plans_provider ON charging_plans(provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_charging_plan ON charging_sessions(charging_plan_id);
