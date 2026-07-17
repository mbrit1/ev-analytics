import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChargingPlan } from '../../../infra/db'
import { getChargingPlanHistory } from '../services/planService'
import { useChargingPlanHistory } from './useChargingPlanHistory'

vi.mock('../services/planService')
vi.mock('../../auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

const plan = {
  id: 'plan-1',
  user_id: 'user-1',
  provider_id: 'provider-1',
  name: 'EnBW L',
  valid_from: new Date('2026-01-01T00:00:00.000Z'),
  valid_to: null,
  monthly_base_fee: 1199,
  session_fee: 0,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
} satisfies ChargingPlan

/**
 * Test suite for the scoped charging-plan history live-query hook.
 *
 * Verifies its mutually exclusive loading, error, and success states and the
 * normalized reference boundary passed to the local service.
 */
describe('useChargingPlanHistory', () => {
  beforeEach(() => {
    vi.mocked(getChargingPlanHistory).mockReset()
  })

  it('loads distinct referenced plan ids and exposes a success state', async () => {
    // Arrange: Resolve one complete logical-tariff history result.
    vi.mocked(getChargingPlanHistory).mockResolvedValue([plan])

    // Act: Render with duplicated, unsorted references.
    const { result } = renderHook(() => useChargingPlanHistory([
      'plan-2',
      'plan-1',
      'plan-2',
    ]))

    // Assert: Loading cannot coexist with data before the query resolves.
    expect(result.current).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current).toEqual({
      status: 'success',
      planVersions: [plan],
    })
    expect(getChargingPlanHistory).toHaveBeenCalledWith(
      'user-1',
      ['plan-1', 'plan-2'],
    )
  })

  it('surfaces local query failures without presenting empty history', async () => {
    // Arrange: Reject the local history read with its original diagnostic.
    const error = new Error('IndexedDB read failed')
    vi.mocked(getChargingPlanHistory).mockRejectedValue(error)

    // Act: Render the live-query hook.
    const { result } = renderHook(() => useChargingPlanHistory(['plan-1']))

    // Assert: The failure is an explicit state, not successful empty data.
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current).toEqual({ status: 'error', error })
  })
})
