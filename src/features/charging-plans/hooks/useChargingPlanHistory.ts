import { useLiveQuery } from 'dexie-react-hooks'
import type { ChargingPlan } from '../../../infra/db'
import { useAuth } from '../../auth'
import { getChargingPlanHistory } from '../services/planService'

/** Explicit live-query state for scoped historical charging-plan data. */
export type ChargingPlanHistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; planVersions: ChargingPlan[] }

type SettledChargingPlanHistoryState = (
  | { status: 'error'; error: unknown }
  | { status: 'success'; planVersions: ChargingPlan[] }
) & { queryKey: string }

/**
 * Subscribes to the user-owned tariff history required by plan references.
 *
 * Reference ids are deduplicated and sorted so equivalent inputs share one
 * stable query boundary. Local read failures remain distinct from empty data.
 */
export function useChargingPlanHistory(
  referencedPlanIds: readonly string[],
): ChargingPlanHistoryState {
  const { user } = useAuth()
  const distinctPlanIds = [...new Set(referencedPlanIds)].sort()
  const queryKey = JSON.stringify([user?.id ?? null, distinctPlanIds])
  const queryState = useLiveQuery<SettledChargingPlanHistoryState>(async () => {
    if (!user) {
      return { status: 'success', planVersions: [], queryKey }
    }

    try {
      const planVersions = await getChargingPlanHistory(user.id, distinctPlanIds)
      return { status: 'success', planVersions, queryKey }
    } catch (error) {
      return { status: 'error', error, queryKey }
    }
  }, [queryKey])

  if (!queryState || queryState.queryKey !== queryKey) {
    return { status: 'loading' }
  }

  return queryState.status === 'error'
    ? { status: 'error', error: queryState.error }
    : { status: 'success', planVersions: queryState.planVersions }
}
