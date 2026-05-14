-- Seed data for EV Analytics
-- This script populates the database with realistic sample data.
-- Requirement: Ensure at least one user exists in auth.users before running.

DO $$
DECLARE
    v_user_id UUID;
    v_ionity_id UUID;
    v_elli_id UUID;
    v_enbw_id UUID;
    v_tesla_id UUID;
    v_ionity_tariff_id UUID;
    v_elli_tariff_id UUID;
    v_enbw_tariff_id UUID;
    v_tesla_tariff_id UUID;
BEGIN
    -- 1. Fetch the first user found in auth.users
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No user found in auth.users. Please create a user manually first as described in HUMAN_SETUP.md';
        RETURN;
    END IF;

    -- 2. Providers
    INSERT INTO providers (user_id, name) VALUES (v_user_id, 'Ionity') RETURNING id INTO v_ionity_id;
    INSERT INTO providers (user_id, name) VALUES (v_user_id, 'Elli') RETURNING id INTO v_elli_id;
    INSERT INTO providers (user_id, name) VALUES (v_user_id, 'EnBW') RETURNING id INTO v_enbw_id;
    INSERT INTO providers (user_id, name) VALUES (v_user_id, 'Tesla') RETURNING id INTO v_tesla_id;

    -- 3. Tariffs (Prices in cents)
    -- Ionity Direct (Premium High Speed)
    INSERT INTO tariffs (user_id, provider_id, tariff_name, ac_price_per_kwh, dc_price_per_kwh, session_fee, valid_from)
    VALUES (v_user_id, v_ionity_id, 'Ionity Direct', 79, 79, 0, '2023-01-01') RETURNING id INTO v_ionity_tariff_id;

    -- Elli Drive Free (Standard Public)
    INSERT INTO tariffs (user_id, provider_id, tariff_name, ac_price_per_kwh, dc_price_per_kwh, session_fee, valid_from)
    VALUES (v_user_id, v_elli_id, 'Drive Free', 54, 73, 0, '2023-01-01') RETURNING id INTO v_elli_tariff_id;

    -- EnBW mobility+ M (Good balance)
    INSERT INTO tariffs (user_id, provider_id, tariff_name, ac_price_per_kwh, dc_price_per_kwh, session_fee, valid_from)
    VALUES (v_user_id, v_enbw_id, 'mobility+ M', 51, 61, 0, '2023-01-01') RETURNING id INTO v_enbw_tariff_id;

    -- Tesla Supercharger
    INSERT INTO tariffs (user_id, provider_id, tariff_name, ac_price_per_kwh, dc_price_per_kwh, session_fee, valid_from)
    VALUES (v_user_id, v_tesla_id, 'Supercharger PAYG', 45, 45, 0, '2023-01-01') RETURNING id INTO v_tesla_tariff_id;

    -- 4. Charging Sessions
    -- High-speed Road Trip (Ionity)
    INSERT INTO charging_sessions (
        user_id, session_timestamp, provider_id, tariff_id, location_type, charging_type, 
        kwh_billed, total_cost, odometer_km, start_soc_percentage, end_soc_percentage, 
        applied_ac_price, applied_dc_price, applied_session_fee, notes
    ) VALUES (
        v_user_id, NOW() - INTERVAL '30 days', v_ionity_id, v_ionity_tariff_id, 'Fast Charger', 'DC',
        52.4, 4140, 45200, 5, 80, 79, 79, 0, 'A7 Nord, Lutterberg. Quick stop.'
    );

    -- Weekly Commute Charging (EnBW AC at Work)
    INSERT INTO charging_sessions (
        user_id, session_timestamp, provider_id, tariff_id, location_type, charging_type, 
        kwh_billed, total_cost, odometer_km, start_soc_percentage, end_soc_percentage, 
        applied_ac_price, applied_dc_price, applied_session_fee, notes
    ) VALUES (
        v_user_id, NOW() - INTERVAL '25 days', v_enbw_id, v_enbw_tariff_id, 'Work', 'AC',
        25.1, 1280, 45450, 40, 95, 51, 61, 0, 'Full charge during shift.'
    );

    -- City Trip (Elli Public AC)
    INSERT INTO charging_sessions (
        user_id, session_timestamp, provider_id, tariff_id, location_type, charging_type, 
        kwh_billed, total_cost, odometer_km, start_soc_percentage, end_soc_percentage, 
        applied_ac_price, applied_dc_price, applied_session_fee, notes
    ) VALUES (
        v_user_id, NOW() - INTERVAL '18 days', v_elli_id, v_elli_tariff_id, 'Public', 'AC',
        12.8, 691, 45680, 55, 85, 54, 73, 0, 'Downtown parking.'
    );

    -- Tesla Supercharger
    INSERT INTO charging_sessions (
        user_id, session_timestamp, provider_id, tariff_id, location_type, charging_type, 
        kwh_billed, total_cost, odometer_km, start_soc_percentage, end_soc_percentage, 
        applied_ac_price, applied_dc_price, applied_session_fee, notes
    ) VALUES (
        v_user_id, NOW() - INTERVAL '12 days', v_tesla_id, v_tesla_tariff_id, 'Fast Charger', 'DC',
        35.0, 1575, 46100, 20, 85, 45, 45, 0, 'Supercharger Hilpoltstein.'
    );

    -- Recent Fast Charge (EnBW DC)
    INSERT INTO charging_sessions (
        user_id, session_timestamp, provider_id, tariff_id, location_type, charging_type, 
        kwh_billed, total_cost, odometer_km, start_soc_percentage, end_soc_percentage, 
        applied_ac_price, applied_dc_price, applied_session_fee, notes
    ) VALUES (
        v_user_id, NOW() - INTERVAL '5 days', v_enbw_id, v_enbw_tariff_id, 'Fast Charger', 'DC',
        40.2, 2452, 46500, 15, 85, 51, 61, 0, 'Last-minute top-up.'
    );

    RAISE NOTICE 'Seed data successfully inserted for user %', v_user_id;

END $$;
