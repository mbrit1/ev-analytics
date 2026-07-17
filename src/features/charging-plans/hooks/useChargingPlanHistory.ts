import { useLiveQuery } from 'dexie-react-hooks'
import type { ChargingPlan } from '../../../infra/db'
import { useAuth } from '../../auth'
import { getChargingPlanHistory } from '../services/planService'

/** Explicit live-query state for scoped historical charging-plan data. */
export type ChargingPlanHistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; planVersions: ChargingPlan[] }

type SettledChargingPlanHistoryState = Exclude<
  ChargingPlanHistoryState,
  { status: 'loading' }
>

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
  const referenceKey = JSON.stringify(distinctPlanIds)
  const queryState = useLiveQuery<SettledChargingPlanHistoryState>(async () => {
    if (!user) {
      return { status: 'success', planVersions: [] }
    }

    try {
      const planVersions = await getChargingPlanHistory(user.id, distinctPlanIds)
      return { status: 'success', planVersions }
    } catch (error) {
      return { status: 'error', error }
    }
  }, [user?.id, referenceKey])

  return queryState ?? { status: 'loading' }
}
