-- 1. Providers Table
CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(user_id, name),
    CONSTRAINT providers_user_id_id_key UNIQUE (user_id, id)
);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'providers'
      AND policyname = 'Users can manage their own providers'
  ) THEN
    CREATE POLICY "Users can manage their own providers"
        ON providers FOR ALL TO authenticated
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

-- 2. Charging Plans Table
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
    deleted_at TIMESTAMPTZ,
    CONSTRAINT charging_plans_user_provider_fkey
      FOREIGN KEY (user_id, provider_id) REFERENCES providers(user_id, id),
    CONSTRAINT charging_plans_user_id_id_key UNIQUE (user_id, id),
    CONSTRAINT charging_plans_validity_object_check
      CHECK (jsonb_typeof(validity) = 'object'),
    CONSTRAINT charging_plans_prices_object_check
      CHECK (jsonb_typeof(prices) = 'object'),
    CONSTRAINT charging_plans_fees_object_check
      CHECK (jsonb_typeof(fees) = 'object'),
    CONSTRAINT charging_plans_affiliation_object_check
      CHECK (affiliation IS NULL OR jsonb_typeof(affiliation) = 'object')
);

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

-- 3. Charging Sessions Table
CREATE TABLE IF NOT EXISTS charging_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_timestamp TIMESTAMPTZ NOT NULL,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    provider_name TEXT NOT NULL,
    charging_plan_id UUID,
    charging_plan_name TEXT,
    charging_type TEXT NOT NULL CHECK (charging_type IN ('AC', 'DC')),
    kwh_billed NUMERIC(6, 2) NOT NULL,
    kwh_added NUMERIC(6, 2),
    total_cost INTEGER NOT NULL,
    pricing_source TEXT NOT NULL DEFAULT 'chargingPlan',
    ad_hoc_pricing JSONB,
    odometer_km INTEGER,
    start_soc_percentage INTEGER,
    end_soc_percentage INTEGER,
    notes TEXT,

    -- Session-level pricing snapshots
    applied_price_per_kwh INTEGER,
    applied_ac_price_per_kwh INTEGER,
    applied_dc_price_per_kwh INTEGER,
    applied_roaming_ac_price_per_kwh INTEGER,
    applied_roaming_dc_price_per_kwh INTEGER,
    applied_monthly_base_fee INTEGER,
    applied_session_fee INTEGER NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT sessions_user_provider_fkey
      FOREIGN KEY (user_id, provider_id) REFERENCES providers(user_id, id),
    CONSTRAINT sessions_user_charging_plan_fkey
      FOREIGN KEY (user_id, charging_plan_id) REFERENCES charging_plans(user_id, id),
    CONSTRAINT sessions_pricing_source_check
      CHECK (pricing_source IN ('chargingPlan', 'adHoc')),
    CONSTRAINT sessions_ad_hoc_pricing_object_check
      CHECK (ad_hoc_pricing IS NULL OR jsonb_typeof(ad_hoc_pricing) = 'object'),
    CONSTRAINT sessions_optional_soc_range_check
      CHECK (
        (start_soc_percentage IS NULL OR (start_soc_percentage BETWEEN 0 AND 100)) AND
        (end_soc_percentage IS NULL OR (end_soc_percentage BETWEEN 0 AND 100))
      ),
    CONSTRAINT sessions_plan_requirement_check
      CHECK (
        (pricing_source = 'chargingPlan' AND charging_plan_id IS NOT NULL)
        OR (pricing_source = 'adHoc' AND ad_hoc_pricing IS NOT NULL)
      )
);

ALTER TABLE charging_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'charging_sessions'
      AND policyname = 'Users can manage their own charging sessions'
  ) THEN
    CREATE POLICY "Users can manage their own charging sessions"
        ON charging_sessions FOR ALL TO authenticated
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_charging_plans_provider ON charging_plans(provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON charging_sessions(session_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_timestamp ON charging_sessions(user_id, session_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_charging_plan ON charging_sessions(charging_plan_id);
