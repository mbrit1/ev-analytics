import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ChargingSession } from '../../../infra/db'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import { useMonthlySessionSpend } from './useMonthlySessionSpend'

function previousFor(selection: Parameters<typeof createAnalyticsPeriod>[0], now: Date) {
  return createPreviousAnalyticsPeriod(createAnalyticsPeriod(selection, now))
}

vi.mock('../../auth', () => ({ useAuth: () => ({ user: { id: 'analytics-owner' } }) }))

function createSession(
  id: string,
  userId: string,
  sessionTimestamp: Date,
  totalCost: number,
  overrides: Partial<Extract<ChargingSession, { session_mode: 'ad_hoc' }>> = {},
): Extract<ChargingSession, { session_mode: 'ad_hoc' }> {
  return {
    id,
    user_id: userId,
    session_mode: 'ad_hoc',
    provider_id: null,
    tariff_plan_id: null,
    plan_selection_id: null,
    pricing_context: 'ad_hoc',
    ad_hoc_pricing: { pricePerKwh: 100 },
    session_timestamp: sessionTimestamp,
    provider_name_snapshot: 'Historical provider',
    charging_type: 'AC',
    kwh_billed: 10,
    total_cost: totalCost,
    applied_session_fee: 0,
    created_at: sessionTimestamp,
    updated_at: sessionTimestamp,
    ...overrides,
  }
}

/** Verifies selected and previous period aggregation and reactivity from local Dexie data. */
describe('selected-period summary local reactivity', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })
  afterEach(async () => {
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })

  it('reacts to an unsynchronized provider snapshot edit without widening the owner-scoped period', async () => {
    // Arrange: The selected period contains one local record and another owner's matching-period row.
    const selectedTime = new Date(2026, 5, 10, 12)
    const selected = createSession('provider-edit-selected', 'analytics-owner', selectedTime, 1200, { provider_name_snapshot: 'Old Provider' })
    const otherOwner = createSession('provider-edit-other-owner', 'someone-else', selectedTime, 9000, { provider_name_snapshot: 'Old Provider' })
    const priorMonth = createSession('provider-edit-prior-month', 'analytics-owner', new Date(2026, 4, 20), 700, { provider_name_snapshot: 'Outside Provider' })
    await db.sessions.bulkPut([selected, otherOwner, priorMonth])
    const now = new Date(2026, 6, 1)
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, now)
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const { result } = renderHook(() => useMonthlySessionSpend(period, previousPeriod))
    await waitFor(() => expect(result.current.providerBreakdown.groups).toEqual([
      expect.objectContaining({ normalizedName: 'old provider', sessionCount: 1, totalCostCents: 1200 }),
    ]))
    const selectedSummary = result.current.result

    // Act: Rename the locally persisted billing snapshot and queue the edit for later sync.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(selected.id, { provider_name_snapshot: 'New Provider' })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...selected, provider_name_snapshot: 'New Provider' }, timestamp: selectedTime })
      })
    })

    // Assert: Provider totals react, while the the unchanged summary stays period-scoped.
    await waitFor(() => expect(result.current.providerBreakdown.groups).toEqual([
      expect.objectContaining({ normalizedName: 'new provider', sessionCount: 1, totalCostCents: 1200 }),
    ]))
    expect(result.current.result).toEqual(selectedSummary)
    expect(result.current.providerBreakdown).toMatchObject({ sessionCount: 1, totalSessionSpendCents: 1200, billedEnergyKwh: 10 })
    expect(result.current.providerBreakdown.periodStartUtc).toEqual(period.startUtc)
    expect(result.current.providerBreakdown.periodEndUtc).toEqual(period.endUtc)
    expect(await db.sync_outbox.count()).toBe(1)
  })

  it('reacts to unsynchronized edits, deletion and preset changes while excluding another owner', async () => {
    // Arrange: Persist current and older local sessions, plus another owner's row.
    const timestamp = new Date(2026, 5, 10)
    const session = createSession('local-session', 'analytics-owner', timestamp, 1000)
    const earlierSession = createSession('earlier-local-session', 'analytics-owner', new Date(2026, 5, 1), 500, { kwh_billed: 5 })
    const chartContextSession = createSession('chart-context', 'analytics-owner', new Date(2026, 3, 15), 700)
    const otherOwnerContext = createSession('other-owner-context', 'someone-else', new Date(2026, 3, 10), 8800)
    await db.sessions.bulkPut([session, earlierSession, chartContextSession, otherOwnerContext, createSession('other-owner', 'someone-else', timestamp, 9900)])
    const monthPeriodNow = new Date(2026, 6, 1)
    const now = new Date(2026, 5, 10, 8)
    const { result, rerender } = renderHook(
      ({ period, previousPeriod }) => useMonthlySessionSpend(period, previousPeriod),
      { initialProps: { period: createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, monthPeriodNow), previousPeriod: previousFor({ kind: 'month', month: { year: 2026, month: 5 } }, monthPeriodNow) } },
    )
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1500))

    // Act: Change the local record and queue it without making a network request.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(session.id, { total_cost: 2400, kwh_billed: 20 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...session, total_cost: 2400, kwh_billed: 20 }, timestamp })
      })
    })

    // Assert: The summary reacts to pending local values and excludes other owners.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2900, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 116, sessionCount: 2 }))
    expect(await db.sync_outbox.count()).toBe(1)

    // Act: Narrow to seven days, then widen to thirty after the local edit.
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now), previousPeriod: previousFor({ kind: 'preset', preset: '7-days' }, now) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2400, billedEnergyKwh: 20, sessionCount: 1 }))
    const editedSession = { ...session, total_cost: 2800, kwh_billed: 25 }
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(session.id, { total_cost: editedSession.total_cost, kwh_billed: editedSession.kwh_billed })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: editedSession, timestamp })
      })
    })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2800, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 112, sessionCount: 1 }))
    expect(await db.sync_outbox.count()).toBe(2)

    // Act: Move the local session outside the selected week without changing its recorded cost.
    await act(async () => { await db.sessions.update(session.id, { session_timestamp: new Date(2026, 5, 2) }) })

    // Assert: The moved record disappears from the selected summary.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 0, isEmpty: true }))

    // Act: Move it back into the selected week with an invalid recorded cost.
    await act(async () => {
      await db.sessions.update(session.id, { session_timestamp: timestamp, total_cost: Number.NaN })
    })

    // Assert: Invalid cents remain unavailable in the summary.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: null, sessionCount: 1 }))

    // Act: Soft-delete the invalid record locally.
    await act(async () => { await db.sessions.update(session.id, { deleted_at: timestamp }) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 0, isEmpty: true, averageSessionPriceCtPerKwh: null }))
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, now), previousPeriod: previousFor({ kind: 'preset', preset: '30-days' }, now) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 500, billedEnergyKwh: 5, sessionCount: 1 }))
  })

  it('reacts to unsynchronized previous-period edits while keeping comparison scoped to the owner and active rows', async () => {
    // Arrange: Current June spend and one active May row are accompanied by excluded rows.
    const now = new Date(2026, 6, 1)
    const selected = createSession('current-period', 'analytics-owner', new Date(2026, 5, 12), 1000)
    const previous = createSession('previous-period', 'analytics-owner', new Date(2026, 4, 12), 500)
    const otherOwner = createSession('other-owner-previous', 'someone-else', new Date(2026, 4, 13), 9000)
    const deleted = createSession('deleted-previous', 'analytics-owner', new Date(2026, 4, 14), 7000, { deleted_at: now })
    await db.sessions.bulkAdd([selected, previous, otherOwner, deleted])
    const selection = { kind: 'month', month: { year: 2026, month: 5 } } as const
    const period = createAnalyticsPeriod(selection, now)
    const { result } = renderHook(() => useMonthlySessionSpend(period, createPreviousAnalyticsPeriod(period)))
    await waitFor(() => expect(result.current.previousResult?.totalSessionSpendCents).toBe(500))
    expect(result.current.comparison).toMatchObject({ status: 'compared', spending: { status: 'percentage', percentage: 100 } })

    // Act: Edit the prior-period local record and preserve its pending outbox write.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(previous.id, { total_cost: 1000 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...previous, total_cost: 1000 }, timestamp: now })
      })
    })

    // Assert: The comparison reacts to local data while current summary and outbox remain intact.
    await waitFor(() => expect(result.current.previousResult?.totalSessionSpendCents).toBe(1000))
    await waitFor(() => expect(result.current.comparison).toMatchObject({ status: 'compared', spending: { status: 'percentage', percentage: 0 } }))
    expect(result.current.result.totalSessionSpendCents).toBe(1000)
    expect(await db.sync_outbox.count()).toBe(1)
  })

  it('updates both aggregates and their comparison when selection and windows change', async () => {
    // Arrange: Persist one session in each of the preceding, selected, and following months.
    const now = new Date(2026, 6, 20, 12)
    await db.sessions.bulkAdd([
      createSession('may', 'analytics-owner', new Date(2026, 4, 10), 1000),
      createSession('june', 'analytics-owner', new Date(2026, 5, 10), 2000),
      createSession('july', 'analytics-owner', new Date(2026, 6, 10), 3000),
    ])
    const juneSelection = { kind: 'month', month: { year: 2026, month: 5 } } as const
    const julySelection = { kind: 'month', month: { year: 2026, month: 6 } } as const
    const { result, rerender } = renderHook(
      ({ period, previousPeriod }) => useMonthlySessionSpend(period, previousPeriod),
      { initialProps: { period: createAnalyticsPeriod(juneSelection, now), previousPeriod: previousFor(juneSelection, now) } },
    )
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(2000))
    await waitFor(() => expect(result.current.previousResult?.totalSessionSpendCents).toBe(1000))

    // Act: Change the calendar selection and both derived bounds.
    rerender({ period: createAnalyticsPeriod(julySelection, now), previousPeriod: previousFor(julySelection, now) })

    // Assert: Current and previous aggregates move together and the comparison updates.
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(3000))
    await waitFor(() => expect(result.current.previousResult?.totalSessionSpendCents).toBe(2000))
    expect(result.current.comparison).toMatchObject({ status: 'compared', spending: { status: 'percentage', percentage: 50 } })
  })

  it('aggregates the selected and previous windows for rolling three-month and year selections', async () => {
    // Arrange: Include rows on both sides of partial period boundaries.
    const now = new Date(2026, 9, 8, 18)
    const threeMonthPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, now)
    const yearPeriod = createAnalyticsPeriod({ kind: 'preset', preset: 'year' }, now)
    const sessions = [
      createSession('before-year', 'analytics-owner', new Date(yearPeriod.startUtc.getTime() - 1), 1100),
      createSession('year-start', 'analytics-owner', yearPeriod.startUtc, 1200),
      createSession('before-three-months', 'analytics-owner', new Date(threeMonthPeriod.startUtc.getTime() - 1), 1300),
      createSession('three-month-start', 'analytics-owner', threeMonthPeriod.startUtc, 1400),
      createSession('inside', 'analytics-owner', new Date(2026, 8, 15), 1500),
      createSession('last-included-day', 'analytics-owner', new Date(threeMonthPeriod.endUtc.getTime() - 1), 1600),
    ]
    await db.sessions.bulkAdd(sessions)
    const initialPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, now)
    const { result, rerender } = renderHook(
      ({ period, previousPeriod }) => useMonthlySessionSpend(period, previousPeriod),
      { initialProps: { period: initialPeriod, previousPeriod: createPreviousAnalyticsPeriod(initialPeriod) } },
    )

    // Act and Assert: Both rolling selections include only their matching previous and selected rows.
    for (const preset of ['3-months', 'year'] as const) {
      if (preset === 'year') rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset }, now), previousPeriod: previousFor({ kind: 'preset', preset }, now) })
      const expected = preset === '3-months'
        ? { sessionCount: 3, totalSessionSpendCents: 4500 }
        : { sessionCount: 5, totalSessionSpendCents: 7000 }
      await waitFor(() => expect(result.current.result).toMatchObject(expected))
      expect(result.current.previousResult).toMatchObject(preset === '3-months'
        ? { sessionCount: 1, totalSessionSpendCents: 1300 }
        : { sessionCount: 1, totalSessionSpendCents: 1100 })
    }
  })

  it('projects live local energy, cost, timestamp, and deletion edits without widening the selected summary', async () => {
    // Arrange: The selected April summary and March comparison are backed by owner-scoped local rows.
    const selectedTime = new Date(2026, 3, 10, 12)
    const selected = createSession('live-selected', 'analytics-owner', selectedTime, 500, { kwh_billed: 5 })
    const context = createSession('live-context', 'analytics-owner', new Date(2026, 2, 10, 12), 300, { kwh_billed: 10 })
    const otherOwner = createSession('live-other-owner', 'someone-else', context.session_timestamp, 9000, { kwh_billed: 90 })
    await db.sessions.bulkPut([selected, context, otherOwner])
    const now = new Date(2026, 4, 1)
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 3 } }, now)
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const { result } = renderHook(() => useMonthlySessionSpend(period, previousPeriod))
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 500, billedEnergyKwh: 5, averageSessionPriceCtPerKwh: 100 }))
    const selectedSummary = result.current.result
    const previousAggregate = () => result.current.previousResult
    await waitFor(() => expect(previousAggregate()).toMatchObject({ totalSessionSpendCents: 300, billedEnergyKwh: 10, validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: 30 }))

    // Act: Edit context energy and cost in an offline transaction.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(context.id, { total_cost: 800, kwh_billed: 20 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...context, total_cost: 800, kwh_billed: 20 }, timestamp: selectedTime })
      })
    })

    // Assert: Previous period updates while selected period summary remains fixed.
    await waitFor(() => expect(previousAggregate()).toMatchObject({ totalSessionSpendCents: 800, billedEnergyKwh: 20, averageSessionPriceCtPerKwh: 40 }))
    expect(result.current.result).toEqual(selectedSummary)

    // Act: Move the context row into the selected month across its local month boundary.
    await act(async () => { await db.sessions.update(context.id, { session_timestamp: new Date(2026, 3, 1) }) })
    await waitFor(() => expect(previousAggregate()).toMatchObject({ totalSessionSpendCents: 0, billedEnergyKwh: null, validBilledEnergySessionCount: 0 }))
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 1300, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 52, sessionCount: 2 }))

    // Act: Soft-delete the moved row; the selected summary returns to its original value.
    await act(async () => { await db.sessions.update(context.id, { deleted_at: selectedTime }) })
    await waitFor(() => expect(result.current.result).toEqual(selectedSummary))
  })

})
