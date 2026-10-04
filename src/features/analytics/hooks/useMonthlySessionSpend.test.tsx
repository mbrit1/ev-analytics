import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessions } from '../../charging-sessions'
import type { ChargingSession } from '../../charging-sessions'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { useMonthlySessionSpend } from './useMonthlySessionSpend'

vi.mock('../../charging-sessions', () => ({
  useSessions: vi.fn(),
}))

function buildSession(timestamp: Date, totalCost: number, billedEnergyKwh = 10): ChargingSession {
  return {
    id: crypto.randomUUID(),
    user_id: 'user-1',
    session_timestamp: timestamp,
    session_mode: 'plan',
    provider_id: 'provider-1',
    tariff_plan_id: 'plan-1',
    provider_name_snapshot: 'Provider',
    charging_type: 'AC',
    kwh_billed: billedEnergyKwh,
    total_cost: totalCost,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

/**
 * Test suite for the monthly session-spend and billed-energy hook.
 *
 * Verifies loading propagation and recomputation when live local sessions or
 * the selected calendar month change.
 */
describe('useMonthlySessionSpend', () => {
  beforeEach(() => {
    vi.mocked(useSessions).mockReset()
  })

  it('propagates loading and aggregates live sessions', () => {
    // Arrange: Return one June session while the local query is still loading.
    vi.mocked(useSessions).mockReturnValue({
      sessions: [buildSession(new Date(2026, 5, 10, 12), 1234, 18.4)],
      pendingSyncIds: new Set(),
      isLoading: true,
      error: null,
      pendingSyncError: null,
    })

    // Act: Render the hook for June.
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const { result } = renderHook(() => useMonthlySessionSpend(period))

    // Assert: Query state and calculated cents are both exposed.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.result.totalSessionSpendCents).toBe(1234)
    expect(result.current.result.billedEnergyKwh).toBe(18.4)
  })

  it('recalculates when the selected month changes', () => {
    // Arrange: Return one session in June and one in July.
    vi.mocked(useSessions).mockReturnValue({
      sessions: [
        buildSession(new Date(2026, 5, 10, 12), 1200),
        buildSession(new Date(2026, 6, 10, 12), 3400),
      ],
      pendingSyncIds: new Set(),
      isLoading: false,
      error: null,
      pendingSyncError: null,
    })
    const now = new Date(2026, 6, 15)

    // Act: Render June, then select July.
    const { result, rerender } = renderHook(
      ({ period }) => useMonthlySessionSpend(period),
      { initialProps: { period: createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, now) } },
    )
    expect(result.current.result.totalSessionSpendCents).toBe(1200)
    rerender({ period: createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, now) })

    // Assert: The new period uses the July session only.
    expect(result.current.result.totalSessionSpendCents).toBe(3400)
    expect(result.current.result.billedEnergyKwh).toBe(10)
    expect(result.current.result.isCurrentMonth).toBe(true)
  })

  it('recalculates when the selected preset changes', () => {
    // Arrange: Return sessions at the seven-day start and later in the month.
    vi.mocked(useSessions).mockReturnValue({
      sessions: [
        buildSession(new Date(2026, 5, 1, 12), 1200),
        buildSession(new Date(2026, 5, 10, 12), 3400),
      ],
      pendingSyncIds: new Set(),
      isLoading: false,
      error: null,
      pendingSyncError: null,
    })
    const now = new Date(2026, 5, 10, 8)
    const { result, rerender } = renderHook(
      ({ period }) => useMonthlySessionSpend(period),
      { initialProps: { period: createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now) } },
    )

    // Act: Widen the selection from seven to thirty calendar days.
    expect(result.current.result.totalSessionSpendCents).toBe(3400)
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, now) })

    // Assert: The earlier session enters the shared selected period.
    expect(result.current.result.totalSessionSpendCents).toBe(4600)
    expect(result.current.result.sessionCount).toBe(2)
  })
  it('exposes session query errors without treating them as an empty result', () => {
    // Arrange
    const error = new Error('read failed')
    vi.mocked(useSessions).mockReturnValue({ sessions: [], pendingSyncIds: new Set(), isLoading: false, error, pendingSyncError: null })
    // Act
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const { result } = renderHook(() => useMonthlySessionSpend(period))
    // Assert
    expect(result.current).toHaveProperty('error', error)
  })

})
