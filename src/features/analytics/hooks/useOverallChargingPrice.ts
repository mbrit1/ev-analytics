import { useMemo } from 'react'
import { useChargingPlanHistory } from '../../charging-plans'
import { useSessions, type ChargingSession } from '../../charging-sessions'
import {
  calculateOverallChargingPrice,
  type LocalDateKey,
  type OverallChargingPriceResult,
} from '../model/overallChargingPrice'

/** Explicit local-query state for the lifetime Overall Price calculation. */
export type OverallChargingPriceQueryState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; result: OverallChargingPriceResult }

function getReferencedPlanIds(sessions: readonly ChargingSession[]): string[] {
  return [...new Set(sessions.flatMap((session) => {
    if (
      session.deleted_at
      || session.session_mode === 'ad_hoc'
      || !session.tariff_plan_id
    ) {
      return []
    }

    return [session.tariff_plan_id]
  }))].sort()
}

/**
 * Combines live local sessions and scoped tariff history into Overall Price.
 *
 * The selected Analytics month is intentionally not an input. Callers own the
 * explicit local-date boundary and update it after local midnight.
 */
export function useOverallChargingPrice(
  asOfLocalDate: LocalDateKey,
): OverallChargingPriceQueryState {
  const {
    sessions,
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useSessions()
  const referencedPlanIds = useMemo(
    () => getReferencedPlanIds(sessions),
    [sessions],
  )
  const historyState = useChargingPlanHistory(referencedPlanIds)

  return useMemo(() => {
    if (sessionsError !== null) {
      return { status: 'error', error: sessionsError }
    }
    if (historyState.status === 'error') {
      return { status: 'error', error: historyState.error }
    }
    if (sessionsLoading || historyState.status === 'loading') {
      return { status: 'loading' }
    }

    return {
      status: 'success',
      result: calculateOverallChargingPrice({
        sessions,
        chargingPlanVersions: historyState.planVersions,
        asOfLocalDate,
      }),
    }
  }, [asOfLocalDate, historyState, sessions, sessionsError, sessionsLoading])
}
