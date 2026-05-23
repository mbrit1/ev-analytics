import Dexie, { type Table } from 'dexie';

/**
 * Charging network, app, or provider that owns one or more charging plans.
 */
export interface Provider {
  /** UUID shared between local Dexie and Supabase. */
  id: string;
  /** Owner id used by Supabase RLS policies. */
  user_id: string;
  /** Human-readable provider name shown in forms and lists. */
  name: string;
  /** Creation timestamp preserved across local edits. */
  created_at: Date;
  /** Last local modification timestamp. */
  updated_at: Date;
  /** Soft-delete marker retained so deletes can sync remotely. */
  deleted_at?: Date;
}

/**
 * Price plan used to calculate charging-session costs.
 *
 * Monetary fields are stored as integer cents to satisfy European localization
 * and avoid floating point currency math.
 */
export interface ChargingPlan {
  /** UUID shared between local Dexie and Supabase. */
  id: string;
  /** Owner id used by Supabase RLS policies. */
  user_id: string;
  /** Provider this charging plan belongs to. */
  provider_id: string;
  /** Human-readable charging plan name shown in selectors and cards. */
  plan_name: string;
  /** Plan validity boundaries. */
  validity: {
    from: Date;
    to?: Date | null;
  };
  /** Domestic and optional roaming energy prices in cents. */
  prices: {
    domestic: {
      ac?: number;
      dc?: number;
    };
    roaming?: {
      ac?: number;
      dc?: number;
    };
  };
  /** Optional fixed-fee pricing components in cents. */
  fees: {
    subscriptionMonthly?: number;
    activationOneTime?: number;
    sessionFixed?: number;
    cardFee?: number;
    other?: Array<{ label: string; amount: number; notes: string }>;
  };
  /** Optional affiliation marker (for memberships/benefits). */
  affiliation?: string;
  /** Optional free-form notes. */
  notes?: string;
  /** Creation timestamp preserved across local edits. */
  created_at: Date;
  /** Last local modification timestamp. */
  updated_at: Date;
  /** Soft-delete marker retained so deletes can sync remotely. */
  deleted_at?: Date;
}

/**
 * Snapshot payload used for ad-hoc charging session pricing.
 */
export interface AdHocPricingSnapshot {
  cpoName?: string | null;
  pricePerKwh: number | null;
  pricePerMinute?: number | null;
  pricePerSession?: number | null;
  otherFees?: Array<{ label: string; amount: number; notes?: string }>;
  receiptUrl?: string | null;
  notes?: string | null;
}

/**
 * Snapshot payload used for plan-linked session and selection history.
 */
export interface TariffPriceSnapshot {
  label: string;
  kWhPrice: number;
  sessionFee?: number;
  blockingFee?: number;
}

/**
 * Immutable-ish provider to plan subscription period history row.
 */
export interface ProviderPlanSelection {
  id: string;
  user_id: string;
  provider_id: string;
  tariff_plan_id: string;
  valid_from: Date;
  valid_to?: Date | null;
  price_snapshot: TariffPriceSnapshot;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

/**
 * Charging event entered by the user and stored offline-first.
 */
export interface ChargingSession {
  /** UUID shared between local Dexie and Supabase. */
  id: string;
  /** Owner id used by Supabase RLS policies. */
  user_id: string;
  /** Date/time when the charging session occurred. */
  session_timestamp: Date;
  /** Provider id selected for plan-based sessions. */
  provider_id?: string | null;
  /** Provider name snapshot for stable history rendering. */
  provider_name: string;
  /** Optional charging plan id selected for this session. */
  charging_plan_id?: string | null;
  /** Optional charging plan name snapshot for stable history rendering. */
  charging_plan_name?: string | null;
  /** Electrical charging mode that selects AC or DC tariff pricing. */
  charging_type: 'AC' | 'DC';
  /** Energy billed by the provider in kWh. */
  kwh_billed: number;
  /** Optional energy added to the battery when it differs from billed energy. */
  kwh_added?: number;
  /** Calculated total session cost in cents. */
  total_cost: number;
  /** Pricing source used when computing this session's cost. */
  pricing_source: 'chargingPlan' | 'adHoc';
  /** Canonical session mode for hard-cutover model. */
  session_mode?: 'plan' | 'adHoc';
  /** Canonical tariff plan id in hard-cutover model. */
  tariff_plan_id?: string | null;
  /** Canonical plan selection history row id in hard-cutover model. */
  plan_selection_id?: string | null;
  /** Canonical immutable snapshot in hard-cutover model. */
  price_snapshot?: TariffPriceSnapshot;
  /** Transitional compatibility mode to preserve standard vs roaming semantics. */
  pricing_context?: 'standard' | 'roaming' | 'ad_hoc';
  /** Optional ad-hoc pricing snapshot used for this session. */
  ad_hoc_pricing?: AdHocPricingSnapshot | null;
  /** Optional odometer reading captured with the session. */
  odometer_km?: number;
  /** Battery state of charge before charging, as a percentage. */
  start_soc_percentage?: number;
  /** Battery state of charge after charging, as a percentage. */
  end_soc_percentage?: number;
  /** Free-form notes for receipt details or charging context. */
  notes?: string;

  /** Snapshot of the effective blended price per kWh in cents when applicable. */
  applied_price_per_kwh?: number;
  /** Snapshot of the tariff's AC price per kWh in cents. */
  applied_ac_price_per_kwh?: number;
  /** Snapshot of the tariff's DC price per kWh in cents. */
  applied_dc_price_per_kwh?: number;
  /** Snapshot of the tariff's roaming AC price per kWh in cents. */
  applied_roaming_ac_price_per_kwh?: number;
  /** Snapshot of the tariff's roaming DC price per kWh in cents. */
  applied_roaming_dc_price_per_kwh?: number;
  /** Snapshot of the tariff's monthly base fee in cents. */
  applied_monthly_base_fee?: number;
  /** Snapshot of the applied fixed session fee in cents. */
  applied_session_fee: number;

  /** Creation timestamp preserved across local edits. */
  created_at: Date;
  /** Last local modification timestamp. */
  updated_at: Date;
  /** Soft-delete marker retained so deletes can sync remotely. */
  deleted_at?: Date;
}

/**
 * Data payload types that can be replayed by the offline sync outbox.
 */
export type SyncPayload = Provider | ChargingPlan | ProviderPlanSelection | ChargingSession;

/**
 * Durable queue item representing a local mutation waiting for Supabase sync.
 */
export interface SyncOutbox {
  /** Auto-incremented local queue id. */
  id?: number;
  /** Local table whose payload should be synced. */
  table_name: 'providers' | 'charging_plans' | 'provider_plan_selections' | 'sessions';
  /** Mutation intent recorded for sync diagnostics and replay behavior. */
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Full record payload needed to replay the mutation remotely. */
  payload: SyncPayload;
  /** Time the local mutation was queued. */
  timestamp: Date;
  /** Number of failed remote sync attempts for this queue item. */
  retry_count?: number;
  /** Most recent time this item was attempted by the sync engine. */
  last_attempt_at?: Date;
  /** Earliest time this item should be retried after a failure. */
  next_attempt_at?: Date;
  /** Last concise failure message recorded for diagnostics. */
  last_error?: string;
}

/** Backward-compatible alias for a single outbox queue entry. */
export type SyncOutboxEntry = SyncOutbox;

/**
 * Dexie database for offline-first EV Analytics data.
 *
 * Stores domain records and the outbox in IndexedDB so charging data entry can
 * continue without network access.
 */
export class EVAnalyticsDB extends Dexie {
  /** Charging providers available to the current user. */
  providers!: Table<Provider>;
  /** Charging plans used for charging cost calculations. */
  charging_plans!: Table<ChargingPlan>;
  /** User-entered charging sessions with price snapshots. */
  sessions!: Table<ChargingSession>;
  /** Active provider to plan history rows with validity windows. */
  provider_plan_selections!: Table<ProviderPlanSelection>;
  /** Pending local mutations to replay to Supabase. */
  sync_outbox!: Table<SyncOutbox>;

  constructor(dbName = 'EVAnalyticsDB') {
    super(dbName);
    this.version(1).stores({
      providers: 'id, name, deleted_at',
      tariffs: 'id, provider_id, deleted_at',
      sessions: 'id, session_timestamp, provider_id, charging_type, deleted_at',
      sync_outbox: '++id, table_name, action, timestamp'
    });
    this.version(2).stores({
      providers: 'id, name, deleted_at',
      tariffs: 'id, provider_id, deleted_at',
      sessions: 'id, session_timestamp, provider_id, charging_type, deleted_at',
      sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
    });
    this.version(3)
      .stores({
        providers: 'id, user_id, name, deleted_at',
        tariffs: 'id, user_id, provider_id, tariff_name, tariff_kind, valid_from, valid_to, deleted_at',
        sessions: 'id, user_id, session_timestamp, provider_id, tariff_id, pricing_context, charging_type, deleted_at',
        fixed_tariff_costs: 'id, user_id, cost_date, provider_id, tariff_id, cost_type, deleted_at',
        sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
      })
      .upgrade(async (tx) => {
        await tx.table('tariffs').toCollection().modify((tariff) => {
          tariff.tariff_kind ??= 'standard';
        });
        await tx.table('sessions').toCollection().modify((session) => {
          const legacySession = session as {
            applied_ac_price?: number;
            applied_dc_price?: number;
          };

          session.pricing_context ??= 'standard';
          session.applied_tariff_kind ??= 'standard';
          session.applied_ac_price_per_kwh ??= legacySession.applied_ac_price;
          session.applied_dc_price_per_kwh ??= legacySession.applied_dc_price;

          if (session.applied_price_per_kwh == null) {
            const isRoaming = session.pricing_context === 'roaming';
            const isAC = session.charging_type === 'AC';
            if (isRoaming && isAC) {
              session.applied_price_per_kwh = session.applied_roaming_ac_price_per_kwh;
            } else if (isRoaming && !isAC) {
              session.applied_price_per_kwh = session.applied_roaming_dc_price_per_kwh;
            } else if (isAC) {
              session.applied_price_per_kwh = session.applied_ac_price_per_kwh;
            } else {
              session.applied_price_per_kwh = session.applied_dc_price_per_kwh;
            }
          }
        });
      });

    this.version(4)
      .stores({
        providers: 'id, user_id, name, deleted_at',
        charging_plans: 'id, user_id, provider_id, plan_name, deleted_at',
        sessions: 'id, user_id, session_timestamp, provider_id, charging_plan_id, pricing_source, charging_type, deleted_at',
        sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
      })
      .upgrade(async (tx) => {
        // Intentional destructive cleanup: this migration assumes there is no
        // production user data yet, so obsolete local tariff/fixed-cost stores
        // and their outbox entries are purged rather than transformed.
        await tx.table('tariffs').clear();
        await tx.table('fixed_tariff_costs').clear();
        await tx
          .table('sync_outbox')
          .where('table_name')
          .anyOf(['tariffs', 'fixed_tariff_costs'])
          .delete();
      });
    this.version(5).stores({
      providers: 'id, user_id, name, deleted_at',
      charging_plans: 'id, user_id, provider_id, plan_name, deleted_at',
      provider_plan_selections: 'id, user_id, provider_id, tariff_plan_id, valid_from, valid_to, deleted_at',
      sessions: 'id, user_id, session_timestamp, provider_id, session_mode, tariff_plan_id, plan_selection_id, charging_type, deleted_at',
      sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
    });
  }
}

/**
 * Shared application database instance.
 */
export const db = new EVAnalyticsDB();
