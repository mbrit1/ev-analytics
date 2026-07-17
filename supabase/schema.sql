-- Clean baseline schema for empty-production import.
-- Final state includes session mode architecture.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Providers
CREATE TABLE IF NOT EXISTS public.providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT providers_user_id_id_key UNIQUE (user_id, id)
);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own providers" ON public.providers;
CREATE POLICY "Users can manage their own providers"
  ON public.providers FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Charging plans
CREATE TABLE IF NOT EXISTS public.charging_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL,
  name TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  valid_period daterange GENERATED ALWAYS AS (
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)')
  ) STORED,
  ac_price_per_kwh INTEGER,
  dc_price_per_kwh INTEGER,
  roaming_ac_price_per_kwh INTEGER,
  roaming_dc_price_per_kwh INTEGER,
  monthly_base_fee INTEGER NOT NULL DEFAULT 0,
  session_fee INTEGER NOT NULL DEFAULT 0,
  affiliation JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT charging_plans_user_provider_fkey
    FOREIGN KEY (user_id, provider_id) REFERENCES public.providers(user_id, id),
  CONSTRAINT charging_plans_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT charging_plans_validity_range_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT charging_plans_price_non_negative_check
    CHECK (
      (ac_price_per_kwh IS NULL OR ac_price_per_kwh >= 0)
      AND (dc_price_per_kwh IS NULL OR dc_price_per_kwh >= 0)
      AND (roaming_ac_price_per_kwh IS NULL OR roaming_ac_price_per_kwh >= 0)
      AND (roaming_dc_price_per_kwh IS NULL OR roaming_dc_price_per_kwh >= 0)
      AND monthly_base_fee >= 0
      AND session_fee >= 0
    ),
  CONSTRAINT charging_plans_affiliation_object_check
    CHECK (affiliation IS NULL OR jsonb_typeof(affiliation) = 'object'),
  CONSTRAINT charging_plans_no_overlapping_active_versions
    EXCLUDE USING gist (
      user_id WITH =,
      provider_id WITH =,
      lower(name) WITH =,
      valid_period WITH &&
    )
    WHERE (deleted_at IS NULL)
);

ALTER TABLE public.charging_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own charging plans" ON public.charging_plans;
CREATE POLICY "Users can manage their own charging plans"
  ON public.charging_plans FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Provider plan selection history
CREATE TABLE IF NOT EXISTS public.provider_plan_selections (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL,
  tariff_plan_id UUID NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  price_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT provider_plan_selections_user_provider_fkey
    FOREIGN KEY (user_id, provider_id) REFERENCES public.providers(user_id, id),
  CONSTRAINT provider_plan_selections_user_tariff_plan_fkey
    FOREIGN KEY (user_id, tariff_plan_id) REFERENCES public.charging_plans(user_id, id),
  CONSTRAINT provider_plan_selections_user_id_id_key
    UNIQUE (user_id, id),
  CONSTRAINT provider_plan_selections_price_snapshot_object_check
    CHECK (jsonb_typeof(price_snapshot) = 'object')
);

ALTER TABLE public.provider_plan_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own provider plan selections" ON public.provider_plan_selections;
CREATE POLICY "Users can select own provider plan selections"
  ON public.provider_plan_selections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own provider plan selections" ON public.provider_plan_selections;
CREATE POLICY "Users can insert own provider plan selections"
  ON public.provider_plan_selections FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own provider plan selections" ON public.provider_plan_selections;
CREATE POLICY "Users can update own provider plan selections"
  ON public.provider_plan_selections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own provider plan selections" ON public.provider_plan_selections;
CREATE POLICY "Users can delete own provider plan selections"
  ON public.provider_plan_selections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Charging sessions
CREATE TABLE IF NOT EXISTS public.charging_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_timestamp TIMESTAMPTZ NOT NULL,
  provider_id UUID,
  provider_name_snapshot TEXT NOT NULL,
  charging_plan_name_snapshot TEXT,
  charging_type TEXT NOT NULL CHECK (charging_type IN ('AC', 'DC')),
  kwh_billed NUMERIC(6, 2) NOT NULL,
  kwh_added NUMERIC(6, 2),
  total_cost INTEGER NOT NULL,
  session_mode TEXT NOT NULL,
  tariff_plan_id UUID,
  ad_hoc_pricing JSONB,
  plan_selection_id UUID,
  price_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    FOREIGN KEY (user_id, provider_id) REFERENCES public.providers(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT sessions_user_tariff_plan_fkey
    FOREIGN KEY (user_id, tariff_plan_id) REFERENCES public.charging_plans(user_id, id),
  CONSTRAINT sessions_user_plan_selection_fkey
    FOREIGN KEY (user_id, plan_selection_id) REFERENCES public.provider_plan_selections(user_id, id),
  CONSTRAINT sessions_ad_hoc_pricing_object_check
    CHECK (ad_hoc_pricing IS NULL OR jsonb_typeof(ad_hoc_pricing) = 'object'),
  CONSTRAINT sessions_price_snapshot_object_check
    CHECK (jsonb_typeof(price_snapshot) = 'object'),
  CONSTRAINT sessions_session_mode_check
    CHECK (session_mode IN ('plan', 'ad_hoc')),
  CONSTRAINT sessions_optional_soc_range_check
    CHECK (
      (start_soc_percentage IS NULL OR (start_soc_percentage BETWEEN 0 AND 100)) AND
      (end_soc_percentage IS NULL OR (end_soc_percentage BETWEEN 0 AND 100))
    ),
  CONSTRAINT sessions_kwh_positive_check
    CHECK (kwh_billed > 0),
  CONSTRAINT sessions_kwh_added_positive_check
    CHECK (kwh_added IS NULL OR kwh_added >= 0),
  CONSTRAINT sessions_total_cost_non_negative_check
    CHECK (total_cost >= 0),
  CONSTRAINT sessions_soc_order_check
    CHECK (
      start_soc_percentage IS NULL
      OR end_soc_percentage IS NULL
      OR end_soc_percentage >= start_soc_percentage
    )
);

-- Keep the canonical schema rerunnable against an existing private project.
-- The production workflow verifies that no legacy ad-hoc rows exist before
-- replacing the former plan/ad-hoc checks with the one-version contract.
ALTER TABLE public.charging_sessions
  ALTER COLUMN provider_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS sessions_plan_requirement_check,
  DROP CONSTRAINT IF EXISTS charging_sessions_plan_mode_requirements,
  DROP CONSTRAINT IF EXISTS charging_sessions_mode_contract_check,
  DROP CONSTRAINT IF EXISTS charging_sessions_provider_name_snapshot_check;

ALTER TABLE public.charging_sessions
  ADD CONSTRAINT charging_sessions_provider_name_snapshot_check
    CHECK (
      provider_name_snapshot ~ '[^[:space:]]'
      AND provider_name_snapshot !~ '^[[:space:]]|[[:space:]]$'
    ),
  ADD CONSTRAINT charging_sessions_mode_contract_check
    CHECK (
      (
        session_mode = 'plan'
        AND provider_id IS NOT NULL
        AND tariff_plan_id IS NOT NULL
        AND ad_hoc_pricing IS NULL
      )
      OR (
        session_mode = 'ad_hoc'
        AND provider_id IS NULL
        AND tariff_plan_id IS NULL
        AND plan_selection_id IS NULL
        AND ad_hoc_pricing IS NOT NULL
      )
    );

ALTER TABLE public.charging_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own charging sessions" ON public.charging_sessions;
CREATE POLICY "Users can manage their own charging sessions"
  ON public.charging_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indices
CREATE INDEX IF NOT EXISTS idx_charging_plans_provider ON public.charging_plans(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS providers_user_name_active_unique
  ON public.providers(user_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS charging_plans_user_provider_name_valid_from_active_unique
  ON public.charging_plans(user_id, provider_id, lower(name), valid_from)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_provider_plan_selections_provider ON public.provider_plan_selections(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_plan_selections_tariff_plan ON public.provider_plan_selections(tariff_plan_id);
CREATE INDEX IF NOT EXISTS idx_provider_plan_selections_user_valid_from ON public.provider_plan_selections(user_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON public.charging_sessions(session_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_timestamp ON public.charging_sessions(user_id, session_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_tariff_plan ON public.charging_sessions(tariff_plan_id);
CREATE INDEX IF NOT EXISTS idx_sessions_plan_selection ON public.charging_sessions(plan_selection_id);
