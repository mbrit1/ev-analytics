import Dexie, { type Table } from 'dexie';

/**
 * Charging network, app, or provider that owns one or more tariffs.
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
export interface Tariff {
  /** UUID shared between local Dexie and Supabase. */
  id: string;
  /** Owner id used by Supabase RLS policies. */
  user_id: string;
  /** Provider this tariff belongs to. */
  provider_id: string;
  /** Human-readable tariff name shown in selectors and cards. */
  tariff_name: string;
  /** AC price per kWh in cents. */
  ac_price_per_kwh: number;
  /** DC price per kWh in cents. */
  dc_price_per_kwh: number;
  /** Fixed per-session fee in cents. */
  session_fee: number;
  /** First date this tariff should be considered active. */
  valid_from: Date;
  /** Optional end date for historical tariff ranges. */
  valid_to?: Date;
  /** Creation timestamp preserved across local edits. */
  created_at: Date;
  /** Last local modification timestamp. */
  updated_at: Date;
  /** Soft-delete marker retained so deletes can sync remotely. */
  deleted_at?: Date;
}

/**
 * Charging event entered by the user and stored offline-first.
 *
 * Provider/tariff names and applied prices are denormalized snapshots so
 * historical costs remain stable after tariff edits.
 */
export interface ChargingSession {
  /** UUID shared between local Dexie and Supabase. */
  id: string;
  /** Owner id used by Supabase RLS policies. */
  user_id: string;
  /** Date/time when the charging session occurred. */
  session_timestamp: Date;
  /** Provider id selected for this session. */
  provider_id: string;
  /** Provider name snapshot for stable history rendering. */
  provider_name: string;
  /** Tariff id selected for this session. */
  tariff_id: string;
  /** Tariff name snapshot for stable history rendering. */
  tariff_name: string;
  /** Physical charging context used for filtering and analytics. */
  location_type: 'Home' | 'Work' | 'Public' | 'Fast Charger';
  /** Electrical charging mode that selects AC or DC tariff pricing. */
  charging_type: 'AC' | 'DC';
  /** Energy billed by the provider in kWh. */
  kwh_billed: number;
  /** Optional energy added to the battery when it differs from billed energy. */
  kwh_added?: number;
  /** Calculated total session cost in cents. */
  total_cost: number;
  /** Optional odometer reading captured with the session. */
  odometer_km?: number;
  /** Battery state of charge before charging, as a percentage. */
  start_soc_percentage: number;
  /** Battery state of charge after charging, as a percentage. */
  end_soc_percentage: number;
  /** Free-form notes for receipt details or charging context. */
  notes?: string;
  
  /** Snapshot of the tariff's AC price per kWh in cents. */
  applied_ac_price: number;
  /** Snapshot of the tariff's DC price per kWh in cents. */
  applied_dc_price: number;
  /** Snapshot of the tariff's fixed session fee in cents. */
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
export type SyncPayload = Provider | Tariff | ChargingSession;

/**
 * Durable queue item representing a local mutation waiting for Supabase sync.
 */
export interface SyncOutbox {
  /** Auto-incremented local queue id. */
  id?: number;
  /** Local table whose payload should be synced. */
  table_name: 'providers' | 'tariffs' | 'sessions';
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

/**
 * Dexie database for offline-first EV Analytics data.
 *
 * Stores domain records and the outbox in IndexedDB so charging data entry can
 * continue without network access.
 */
export class EVAnalyticsDB extends Dexie {
  /** Charging providers available to the current user. */
  providers!: Table<Provider>;
  /** Tariff plans used for charging cost calculations. */
  tariffs!: Table<Tariff>;
  /** User-entered charging sessions with price snapshots. */
  sessions!: Table<ChargingSession>;
  /** Pending local mutations to replay to Supabase. */
  sync_outbox!: Table<SyncOutbox>;

  constructor() {
    super('EVAnalyticsDB');
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
  }
}

/**
 * Shared application database instance.
 */
export const db = new EVAnalyticsDB();
