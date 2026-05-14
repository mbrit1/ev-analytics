-- 1. Providers Table
CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own providers"
    ON providers FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2. Tariffs Table
CREATE TABLE tariffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    tariff_name TEXT NOT NULL,
    ac_price_per_kwh INTEGER NOT NULL, -- Stored in cents
    dc_price_per_kwh INTEGER NOT NULL, -- Stored in cents
    session_fee INTEGER NOT NULL DEFAULT 0, -- Stored in cents
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own tariffs"
    ON tariffs FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3. Charging Sessions Table
CREATE TABLE charging_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_timestamp TIMESTAMPTZ NOT NULL,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    tariff_id UUID NOT NULL REFERENCES tariffs(id) ON DELETE RESTRICT,
    location_type TEXT NOT NULL CHECK (location_type IN ('Home', 'Work', 'Public', 'Fast Charger')),
    charging_type TEXT NOT NULL CHECK (charging_type IN ('AC', 'DC')),
    kwh_billed NUMERIC(6, 2) NOT NULL,
    kwh_added NUMERIC(6, 2), -- Optional efficiency tracking
    total_cost INTEGER NOT NULL, -- Stored in cents
    odometer_km INTEGER,
    start_soc INTEGER CHECK (start_soc >= 0 AND start_soc <= 100),
    end_soc INTEGER CHECK (end_soc >= 0 AND end_soc <= 100),
    notes TEXT,
    
    -- Snapshots of the tariff at the time of the session
    applied_ac_price INTEGER NOT NULL,
    applied_dc_price INTEGER NOT NULL,
    applied_session_fee INTEGER NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE charging_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own charging sessions"
    ON charging_sessions FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Indices for performance
CREATE INDEX idx_tariffs_provider ON tariffs(provider_id);
CREATE INDEX idx_sessions_timestamp ON charging_sessions(session_timestamp DESC);
CREATE INDEX idx_sessions_user_timestamp ON charging_sessions(user_id, session_timestamp DESC);
