import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessions } from '../../charging-sessions'
import type { ChargingSession } from '../../charging-sessions'
import { useMonthlySessionSpend } from './useMonthlySessionSpend'

vi.mock('../../charging-sessions', () => ({
  useSessions: vi.fn(),
}))

function buildSession(timestamp: Date, totalCost: number): ChargingSession {
  return {
    id: crypto.randomUUID(),
    user_id: 'user-1',
    session_timestamp: timestamp,
    provider_id: 'provider-1',
    provider_name_snapshot: 'Provider',
    charging_type: 'AC',
    kwh_billed: 10,
    total_cost: totalCost,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

/**
 * Test suite for the monthly session-spend hook.
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
      sessions: [buildSession(new Date(2026, 5, 10, 12), 1234)],
      pendingSyncIds: new Set(),
      isLoading: true,
    })

    // Act: Render the hook for June.
    const { result } = renderHook(() => useMonthlySessionSpend(
      { year: 2026, month: 5 },
      new Date(2026, 6, 1),
    ))

    // Assert: Query state and calculated cents are both exposed.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.result.totalSessionSpendCents).toBe(1234)
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
    })
    const now = new Date(2026, 6, 15)

    // Act: Render June, then select July.
    const { result, rerender } = renderHook(
      ({ month }) => useMonthlySessionSpend(month, now),
      { initialProps: { month: { year: 2026, month: 5 } } },
    )
    expect(result.current.result.totalSessionSpendCents).toBe(1200)
    rerender({ month: { year: 2026, month: 6 } })

    // Assert: The new period uses the July session only.
    expect(result.current.result.totalSessionSpendCents).toBe(3400)
    expect(result.current.result.isCurrentMonth).toBe(true)
  })
})
