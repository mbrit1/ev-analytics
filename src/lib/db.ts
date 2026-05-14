import Dexie, { Table } from 'dexie';

// Interfaces for the Domain-Optimized Schema
export interface Provider {
  id: string; // UUID from Supabase
  name: string;
  created_at: Date;
  deleted_at?: Date;
}

export interface Tariff {
  id: string;
  provider_id: string;
  tariff_name: string;
  ac_price_per_kwh: number;
  dc_price_per_kwh: number;
  session_fee: number;
  valid_from: Date;
  valid_to?: Date;
  deleted_at?: Date;
}

export interface ChargingSession {
  id: string;
  session_timestamp: Date;
  provider_id: string;
  provider_name: string; // Denormalized for UI
  tariff_id: string;
  tariff_name: string; // Denormalized for UI
  location_type: 'Home' | 'Work' | 'Public' | 'Fast Charger';
  charging_type: 'AC' | 'DC';
  kwh_billed: number;
  kwh_added?: number;
  total_cost: number;
  odometer_km?: number;
  start_soc: number;
  end_soc: number;
  notes?: string;
  
  // Snapshots
  applied_ac_price: number;
  applied_dc_price: number;
  applied_session_fee: number;
  
  updated_at: Date;
  deleted_at?: Date;
}

export interface SyncOutbox {
  id?: number;
  table_name: 'providers' | 'tariffs' | 'sessions';
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: any;
  timestamp: Date;
}

export class EVAnalyticsDB extends Dexie {
  providers!: Table<Provider>;
  tariffs!: Table<Tariff>;
  sessions!: Table<ChargingSession>;
  sync_outbox!: Table<SyncOutbox>;

  constructor() {
    super('EVAnalyticsDB');
    this.version(1).stores({
      providers: 'id, name, deleted_at',
      tariffs: 'id, provider_id, deleted_at',
      sessions: 'id, session_timestamp, provider_id, charging_type, deleted_at',
      sync_outbox: '++id, table_name, action, timestamp'
    });
  }
}

export const db = new EVAnalyticsDB();
