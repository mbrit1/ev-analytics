-- Seed data for EV Analytics charging-plan architecture.
-- Requirement: Ensure at least one user exists in auth.users before running.

DO $$
DECLARE
    v_user_id UUID;
    v_ionity_id UUID := '00000000-0000-0000-0000-000000000101';
    v_enbw_id UUID := '00000000-0000-0000-0000-000000000102';
    v_ionity_plan_id UUID := '00000000-0000-0000-0000-000000000201';
    v_enbw_plan_id UUID := '00000000-0000-0000-0000-000000000202';
BEGIN
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No user found in auth.users. Please create a user manually first as described in docs/infrastructure-runbook.md';
        RETURN;
    END IF;

    -- Providers (rerun-safe)
    INSERT INTO providers (id, user_id, name)
    VALUES (v_ionity_id, v_user_id, 'Ionity')
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          updated_at = NOW(),
          deleted_at = NULL;

    INSERT INTO providers (id, user_id, name)
    VALUES (v_enbw_id, v_user_id, 'EnBW')
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          updated_at = NOW(),
          deleted_at = NULL;

    -- Charging plans (rerun-safe)
    INSERT INTO charging_plans (
      id,
      user_id,
      provider_id,
      name,
      valid_from,
      valid_to,
      ac_price_per_kwh,
      dc_price_per_kwh,
      roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh,
      monthly_base_fee,
      session_fee,
      affiliation,
      notes
    ) VALUES (
      v_ionity_plan_id,
      v_user_id,
      v_ionity_id,
      'Ionity Direct',
      DATE '2023-01-01',
      NULL,
      79,
      79,
      NULL,
      NULL,
      0,
      0,
      NULL,
      'Seed: ionity baseline plan'
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          provider_id = EXCLUDED.provider_id,
          name = EXCLUDED.name,
          valid_from = EXCLUDED.valid_from,
          valid_to = EXCLUDED.valid_to,
          ac_price_per_kwh = EXCLUDED.ac_price_per_kwh,
          dc_price_per_kwh = EXCLUDED.dc_price_per_kwh,
          roaming_ac_price_per_kwh = EXCLUDED.roaming_ac_price_per_kwh,
          roaming_dc_price_per_kwh = EXCLUDED.roaming_dc_price_per_kwh,
          monthly_base_fee = EXCLUDED.monthly_base_fee,
          session_fee = EXCLUDED.session_fee,
          affiliation = EXCLUDED.affiliation,
          notes = EXCLUDED.notes,
          updated_at = NOW(),
          deleted_at = NULL;

    INSERT INTO charging_plans (
      id,
      user_id,
      provider_id,
      name,
      valid_from,
      valid_to,
      ac_price_per_kwh,
      dc_price_per_kwh,
      roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh,
      monthly_base_fee,
      session_fee,
      affiliation,
      notes
    ) VALUES (
      v_enbw_plan_id,
      v_user_id,
      v_enbw_id,
      'mobility+ M',
      DATE '2023-01-01',
      NULL,
      51,
      61,
      59,
      69,
      0,
      0,
      '{"membership":"mobility+"}'::jsonb,
      'Seed: enbw roaming-capable plan'
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          provider_id = EXCLUDED.provider_id,
          name = EXCLUDED.name,
          valid_from = EXCLUDED.valid_from,
          valid_to = EXCLUDED.valid_to,
          ac_price_per_kwh = EXCLUDED.ac_price_per_kwh,
          dc_price_per_kwh = EXCLUDED.dc_price_per_kwh,
          roaming_ac_price_per_kwh = EXCLUDED.roaming_ac_price_per_kwh,
          roaming_dc_price_per_kwh = EXCLUDED.roaming_dc_price_per_kwh,
          monthly_base_fee = EXCLUDED.monthly_base_fee,
          session_fee = EXCLUDED.session_fee,
          affiliation = EXCLUDED.affiliation,
          notes = EXCLUDED.notes,
          updated_at = NOW(),
          deleted_at = NULL;

    -- Plan-based charging session snapshot (rerun-safe)
    INSERT INTO charging_sessions (
        id,
        user_id,
        session_timestamp,
        provider_id,
        provider_name_snapshot,
        tariff_plan_id,
        charging_plan_name_snapshot,
        charging_type,
        kwh_billed,
        total_cost,
        session_mode,
        tariff_plan_id,
        applied_ac_price_per_kwh,
        applied_dc_price_per_kwh,
        applied_session_fee,
        notes
    ) VALUES (
        '00000000-0000-0000-0000-000000000301',
        v_user_id,
        NOW() - INTERVAL '5 days',
        v_enbw_id,
        'EnBW',
        v_enbw_plan_id,
        'mobility+ M',
        'DC',
        40.2,
        2452,
        'plan',
        'plan',
        v_enbw_plan_id,
        51,
        61,
        0,
        'Plan-based DC top-up.'
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          session_timestamp = EXCLUDED.session_timestamp,
          provider_id = EXCLUDED.provider_id,
          provider_name_snapshot = EXCLUDED.provider_name_snapshot,
          tariff_plan_id = EXCLUDED.tariff_plan_id,
          charging_plan_name_snapshot = EXCLUDED.charging_plan_name_snapshot,
          charging_type = EXCLUDED.charging_type,
          kwh_billed = EXCLUDED.kwh_billed,
          total_cost = EXCLUDED.total_cost,
          session_mode = EXCLUDED.session_mode,
          tariff_plan_id = EXCLUDED.tariff_plan_id,
          applied_ac_price_per_kwh = EXCLUDED.applied_ac_price_per_kwh,
          applied_dc_price_per_kwh = EXCLUDED.applied_dc_price_per_kwh,
          applied_session_fee = EXCLUDED.applied_session_fee,
          notes = EXCLUDED.notes,
          updated_at = NOW(),
          deleted_at = NULL;

    -- Ad-hoc charging session snapshot (no plan id/name required, rerun-safe)
    INSERT INTO charging_sessions (
        id,
        user_id,
        session_timestamp,
        provider_id,
        provider_name_snapshot,
        tariff_plan_id,
        charging_plan_name_snapshot,
        charging_type,
        kwh_billed,
        total_cost,
        session_mode,
        tariff_plan_id,
        plan_selection_id,
        ad_hoc_pricing,
        applied_price_per_kwh,
        applied_session_fee,
        notes
    ) VALUES (
        '00000000-0000-0000-0000-000000000302',
        v_user_id,
        NOW() - INTERVAL '2 days',
        v_ionity_id,
        'Ionity',
        NULL,
        NULL,
        'DC',
        18.6,
        1469,
        'ad_hoc',
        'ad_hoc',
        NULL,
        NULL,
        '{"cpoName":"Ionity","pricePerKwh":79,"priceCapturedFrom":"stationDisplay"}'::jsonb,
        79,
        0,
        'Ad-hoc receipt-based entry.'
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          session_timestamp = EXCLUDED.session_timestamp,
          provider_id = EXCLUDED.provider_id,
          provider_name_snapshot = EXCLUDED.provider_name_snapshot,
          tariff_plan_id = EXCLUDED.tariff_plan_id,
          charging_plan_name_snapshot = EXCLUDED.charging_plan_name_snapshot,
          charging_type = EXCLUDED.charging_type,
          kwh_billed = EXCLUDED.kwh_billed,
          total_cost = EXCLUDED.total_cost,
          session_mode = EXCLUDED.session_mode,
          tariff_plan_id = EXCLUDED.tariff_plan_id,
          plan_selection_id = EXCLUDED.plan_selection_id,
          ad_hoc_pricing = EXCLUDED.ad_hoc_pricing,
          applied_price_per_kwh = EXCLUDED.applied_price_per_kwh,
          applied_session_fee = EXCLUDED.applied_session_fee,
          notes = EXCLUDED.notes,
          updated_at = NOW(),
          deleted_at = NULL;

    RAISE NOTICE 'Charging-plan seed data inserted for user %', v_user_id;
END $$;
