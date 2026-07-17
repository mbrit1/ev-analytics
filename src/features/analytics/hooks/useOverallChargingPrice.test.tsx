import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  useChargingPlanHistory,
  type ChargingPlan,
  type ChargingPlanHistoryState,
} from '../../charging-plans'
import {
  useSessions,
  type ChargingSession,
} from '../../charging-sessions'
import type { LocalDateKey } from '../model/overallChargingPrice'
import { useOverallChargingPrice } from './useOverallChargingPrice'

vi.mock('../../charging-plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charging-plans')>()

  return {
    ...actual,
    useChargingPlanHistory: vi.fn(),
  }
})
vi.mock('../../charging-sessions', () => ({
  useSessions: vi.fn(),
}))

const utcDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`)

type PlanSession = Extract<ChargingSession, { session_mode: 'plan' }>
type AdHocSession = Extract<ChargingSession, { session_mode: 'ad_hoc' }>

function buildPlan(overrides: Partial<ChargingPlan> = {}): ChargingPlan {
  return {
    id: overrides.id ?? 'plan-1',
    user_id: overrides.user_id ?? 'user-1',
    provider_id: overrides.provider_id ?? 'provider-1',
    name: overrides.name ?? 'EnBW L',
    valid_from: overrides.valid_from ?? utcDate('2026-07-01'),
    valid_to: overrides.valid_to ?? null,
    monthly_base_fee: overrides.monthly_base_fee ?? 3100,
    session_fee: overrides.session_fee ?? 0,
    created_at: overrides.created_at ?? utcDate('2026-07-01'),
    updated_at: overrides.updated_at ?? utcDate('2026-07-01'),
    deleted_at: overrides.deleted_at,
  }
}

function buildSession(overrides: Partial<PlanSession> = {}): PlanSession {
  const timestamp = overrides.session_timestamp ?? new Date(2026, 6, 10, 12)

  return {
    id: overrides.id ?? 'session-1',
    user_id: overrides.user_id ?? 'user-1',
    session_timestamp: timestamp,
    provider_id: overrides.provider_id ?? 'provider-1',
    provider_name_snapshot: overrides.provider_name_snapshot ?? 'EnBW',
    charging_type: overrides.charging_type ?? 'AC',
    kwh_billed: overrides.kwh_billed ?? 10,
    total_cost: overrides.total_cost ?? 500,
    session_mode: 'plan',
    tariff_plan_id: overrides.tariff_plan_id ?? 'plan-1',
    applied_session_fee: overrides.applied_session_fee ?? 0,
    created_at: overrides.created_at ?? timestamp,
    updated_at: overrides.updated_at ?? timestamp,
    deleted_at: overrides.deleted_at,
  }
}

function buildAdHocSession(overrides: Partial<AdHocSession> = {}): AdHocSession {
  const timestamp = overrides.session_timestamp ?? new Date(2026, 6, 10, 12)

  return {
    id: overrides.id ?? 'ad-hoc-session-1',
    user_id: overrides.user_id ?? 'user-1',
    session_timestamp: timestamp,
    provider_id: null,
    provider_name_snapshot: overrides.provider_name_snapshot ?? 'Ad hoc provider',
    charging_type: overrides.charging_type ?? 'AC',
    kwh_billed: overrides.kwh_billed ?? 10,
    total_cost: overrides.total_cost ?? 500,
    session_mode: 'ad_hoc',
    tariff_plan_id: null,
    plan_selection_id: null,
    pricing_context: 'ad_hoc',
    ad_hoc_pricing: overrides.ad_hoc_pricing ?? { pricePerKwh: null },
    applied_session_fee: overrides.applied_session_fee ?? 0,
    created_at: overrides.created_at ?? timestamp,
    updated_at: overrides.updated_at ?? timestamp,
    deleted_at: overrides.deleted_at,
  }
}

type SessionsHookState = ReturnType<typeof useSessions> & { error: unknown | null }

function sessionsState(
  overrides: Partial<SessionsHookState> = {},
): SessionsHookState {
  return {
    sessions: [],
    pendingSyncIds: new Set(),
    isLoading: false,
    error: null,
    pendingSyncError: null,
    ...overrides,
  }
}

/**
 * Test suite for the live lifetime Overall Price composition hook.
 *
 * Verifies strict query states, source-error recovery, reference derivation,
 * and recomputation from local session, tariff-history, and date changes.
 */
describe('useOverallChargingPrice', () => {
  beforeEach(() => {
    vi.mocked(useSessions).mockReset()
    vi.mocked(useChargingPlanHistory).mockReset()
  })

  it('remains loading until both source queries have succeeded', () => {
    // Arrange: Session data is loading while tariff history is already ready.
    vi.mocked(useSessions).mockReturnValue(sessionsState({ isLoading: true }))
    vi.mocked(useChargingPlanHistory).mockReturnValue({
      status: 'success',
      planVersions: [],
    })

    // Act: Compose the lifetime query.
    const { result } = renderHook(() => useOverallChargingPrice('2026-07-15'))

    // Assert: No empty calculation can masquerade as loaded data.
    expect(result.current).toEqual({ status: 'loading' })
  })

  it.each([
    ['sessions', new Error('Session query failed')],
    ['charging plans', new Error('Tariff history query failed')],
  ])('surfaces %s technical errors without calculating partial data', (source, error) => {
    // Arrange: Fail exactly one source while the other is successful.
    vi.mocked(useSessions).mockReturnValue(sessionsState({
      error: source === 'sessions' ? error : null,
    }))
    vi.mocked(useChargingPlanHistory).mockReturnValue(
      source === 'charging plans'
        ? { status: 'error', error }
        : { status: 'loading' },
    )

    // Act: Compose the lifetime query.
    const { result } = renderHook(() => useOverallChargingPrice('2026-07-15'))

    // Assert: Technical failure is distinct from calculator unavailable states.
    expect(result.current).toEqual({ status: 'error', error })
  })

  it('requests distinct active plan references and calculates all active sessions', () => {
    // Arrange: Mix duplicate plan references, deleted data, and ad-hoc history.
    const plan = buildPlan()
    vi.mocked(useSessions).mockReturnValue(sessionsState({
      sessions: [
        buildSession({ id: 'plan-one' }),
        buildSession({ id: 'plan-two', tariff_plan_id: plan.id }),
        buildAdHocSession({
          id: 'ad-hoc',
          total_cost: 300,
        }),
        buildSession({
          id: 'deleted',
          tariff_plan_id: 'deleted-reference',
          deleted_at: new Date(2026, 6, 11),
        }),
      ],
    }))
    vi.mocked(useChargingPlanHistory).mockReturnValue({
      status: 'success',
      planVersions: [plan],
    })

    // Act: Compose the lifetime result.
    const { result } = renderHook(() => useOverallChargingPrice('2026-07-15'))

    // Assert: Only the one relevant tariff id drives history hydration.
    expect(useChargingPlanHistory).toHaveBeenCalledWith([plan.id])
    expect(result.current).toMatchObject({
      status: 'success',
      result: {
        status: 'ready',
        sessionCount: 3,
        billedEnergyKwh: 30,
        sessionSpendCents: 1300,
      },
    })
  })

  it('recomputes after source recovery and local date changes', () => {
    // Arrange: Keep source values mutable to simulate live-query transitions.
    const plan = buildPlan()
    let sessionSource = sessionsState({ sessions: [buildSession()] })
    let historySource: ChargingPlanHistoryState = {
      status: 'error',
      error: new Error('Temporary tariff read failure'),
    }
    vi.mocked(useSessions).mockImplementation(() => sessionSource)
    vi.mocked(useChargingPlanHistory).mockImplementation(() => historySource)
    const { result, rerender } = renderHook(
      ({ asOfLocalDate }) => useOverallChargingPrice(asOfLocalDate),
      { initialProps: { asOfLocalDate: '2026-07-10' } },
    )
    expect(result.current.status).toBe('error')

    // Act: Recover history, then change local data and advance the local date.
    historySource = { status: 'success', planVersions: [plan] }
    rerender({ asOfLocalDate: '2026-07-10' })
    expect(result.current).toMatchObject({
      status: 'success',
      result: { status: 'ready', fixedCostCents: 1000 },
    })
    sessionSource = sessionsState({
      sessions: [buildSession(), buildSession({ id: 'session-2' })],
    })
    rerender({ asOfLocalDate: '2026-07-20' })

    // Assert: Session totals and the current-day fee horizon both update locally.
    expect(result.current).toMatchObject({
      status: 'success',
      result: {
        status: 'ready',
        sessionCount: 2,
        sessionSpendCents: 1000,
        fixedCostCents: 2000,
      },
    })
  })

  it('recomputes when local tariff history changes', () => {
    // Arrange: Start with the original July fee and one qualifying session.
    const plan = buildPlan()
    let historySource: ChargingPlanHistoryState = {
      status: 'success',
      planVersions: [plan],
    }
    vi.mocked(useSessions).mockReturnValue(sessionsState({
      sessions: [buildSession()],
    }))
    vi.mocked(useChargingPlanHistory).mockImplementation(() => historySource)
    const { result, rerender } = renderHook(
      () => useOverallChargingPrice('2026-07-10'),
    )
    expect(result.current).toMatchObject({
      status: 'success',
      result: { status: 'ready', fixedCostCents: 1000 },
    })

    // Act: Replace the locally stored tariff history with a doubled base fee.
    historySource = {
      status: 'success',
      planVersions: [buildPlan({ monthly_base_fee: 6200 })],
    }
    rerender()

    // Assert: The lifetime result updates without a network input.
    expect(result.current).toMatchObject({
      status: 'success',
      result: { status: 'ready', fixedCostCents: 2000 },
    })
  })

  it('rejects a non-canonical explicit local date', () => {
    // Arrange: Make both local data sources successful.
    vi.mocked(useSessions).mockReturnValue(sessionsState())
    vi.mocked(useChargingPlanHistory).mockReturnValue({
      status: 'success',
      planVersions: [],
    })

    // Act / Assert: Caller date errors remain distinct from query failures.
    expect(() => renderHook(() => useOverallChargingPrice('2026-7-15')))
      .toThrow(RangeError)
  })

  it('accepts only the explicit local date boundary', () => {
    // Assert: A selected Analytics month cannot become a calculation input.
    expectTypeOf(useOverallChargingPrice).parameters.toEqualTypeOf<[
      LocalDateKey,
    ]>()
  })
})
