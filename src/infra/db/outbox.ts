import type {
  ChargingPlan,
  ChargingSession,
  Provider,
  ProviderPlanSelection,
  SyncOutbox,
} from './db';

type SyncPayloadByTable = {
  providers: Provider;
  charging_plans: ChargingPlan;
  provider_plan_selections: ProviderPlanSelection;
  sessions: ChargingSession;
};

/** Creates a fresh typed outbox row while leaving persistence to the caller's transaction. */
export function createSyncOutboxEntry<TableName extends keyof SyncPayloadByTable>(
  tableName: TableName,
  action: SyncOutbox['action'],
  payload: SyncPayloadByTable[TableName],
  timestamp: Date,
): SyncOutbox {
  return {
    table_name: tableName,
    action,
    payload,
    timestamp,
    retry_count: 0,
    last_attempt_at: undefined,
    next_attempt_at: undefined,
    last_error: undefined,
  };
}
