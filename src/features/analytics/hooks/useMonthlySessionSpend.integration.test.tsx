import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ChargingSession } from '../../../infra/db'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { useMonthlySessionSpend } from './useMonthlySessionSpend'

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

/** Verifies selected-period aggregation and wider chart reactivity from local Dexie data. */
describe('selected-period summary local reactivity', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })
  afterEach(async () => {
    await db.sessions.clear()
    await db.sync_outbox.clear()
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
      ({ period }) => useMonthlySessionSpend(period),
      { initialProps: { period: createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, monthPeriodNow) } },
    )
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1500))
    expect(result.current.trend).not.toBeNull()
    const selectedBucket = result.current.trend!.buckets.find((bucket) => bucket.month.year === 2026 && bucket.month.month === 5)
    expect(selectedBucket).toMatchObject({ totalSessionSpendCents: 1500, sessionCount: 2 })
    expect(result.current.trend!.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(2200)

    // Act: Change the local record and queue it without making a network request.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(session.id, { total_cost: 2400, kwh_billed: 20 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...session, total_cost: 2400, kwh_billed: 20 }, timestamp })
      })
    })

    // Assert: The summary reacts to pending local values and excludes other owners.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2900, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 116, sessionCount: 2 }))
    expect(result.current.trend).not.toBeNull()
    expect(result.current.trend!.buckets.at(-1)?.totalSessionSpendCents).toBe(2900)
    expect(await db.sync_outbox.count()).toBe(1)

    // Act: Narrow to seven days, then widen to thirty after the local edit.
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2400, billedEnergyKwh: 20, sessionCount: 1 }))
    expect(result.current.trend).not.toBeNull()
    const editedSession = { ...session, total_cost: 2800, kwh_billed: 25 }
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(session.id, { total_cost: editedSession.total_cost, kwh_billed: editedSession.kwh_billed })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: editedSession, timestamp })
      })
    })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2800, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 112, sessionCount: 1 }))
    expect(result.current.trend).not.toBeNull()
    expect(await db.sync_outbox.count()).toBe(2)

    // Act: Move the local session outside the selected week without changing its recorded cost.
    await act(async () => { await db.sessions.update(session.id, { session_timestamp: new Date(2026, 5, 2) }) })

    // Assert: The moved record disappears from the selected summary while the context chart remains available.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 0, isEmpty: true }))
    expect(result.current.trend).not.toBeNull()

    // Act: Move it back into the selected week with an invalid recorded cost.
    await act(async () => {
      await db.sessions.update(session.id, { session_timestamp: timestamp, total_cost: Number.NaN })
    })

    // Assert: Invalid cents remain unavailable in the summary and their chart context remains inspectable.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: null, sessionCount: 1 }))
    expect(result.current.trend).not.toBeNull()

    // Act: Soft-delete the invalid record locally.
    await act(async () => { await db.sessions.update(session.id, { deleted_at: timestamp }) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 0, isEmpty: true, averageSessionPriceCtPerKwh: null }))
    expect(result.current.trend).not.toBeNull()
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, now) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 500, billedEnergyKwh: 5, sessionCount: 1 }))
    expect(result.current.trend).not.toBeNull()
  })

  it('keeps a short-period summary scoped while its three-month local chart context changes', async () => {
    // Arrange: One selected-week session and one earlier context session are stored locally.
    const now = new Date(2026, 5, 10, 12)
    const selected = createSession('short-selected', 'analytics-owner', new Date(2026, 5, 10, 10), 1200)
    const context = createSession('short-context', 'analytics-owner', new Date(2026, 3, 12, 10), 300)
    await db.sessions.bulkAdd([selected, context])
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now)
    const { result } = renderHook(() => useMonthlySessionSpend(period))
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1200))
    const selectedSummary = result.current.result

    // Act: Make only the earlier three-month context cost invalid through an offline write.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(context.id, { total_cost: Number.NaN })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...context, total_cost: Number.NaN }, timestamp: now })
      })
    })

    // Assert: Context is unavailable in the chart while the 7-day summary remains unchanged.
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)?.totalSessionSpendCents).toBeNull())
    expect(result.current.trend).not.toBeNull()
    expect(result.current.result).toEqual(selectedSummary)
    expect(await db.sync_outbox.count()).toBe(1)

    // Act: Update the selected session locally and queue it for later synchronization.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(selected.id, { total_cost: 1800 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...selected, total_cost: 1800 }, timestamp: now })
      })
    })

    // Assert: The selected summary and chart bucket react while the invalid context stays isolated.
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1800))
    expect(result.current.trend!.buckets.at(-1)).toMatchObject({ month: { year: 2026, month: 5 }, totalSessionSpendCents: 1800 })
    expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)?.totalSessionSpendCents).toBeNull()
    expect(await db.sync_outbox.count()).toBe(2)
  })

  it('keeps the selected summary fixed while chart context is created, moved and deleted offline', async () => {
    // Arrange: June is selected; the chart initially has no earlier context.
    const selectedTimestamp = new Date(2026, 5, 12, 12)
    const selected = createSession('selected', 'analytics-owner', selectedTimestamp, 1200)
    await db.sessions.add(selected)
    const selectedPeriod = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const { result } = renderHook(() => useMonthlySessionSpend(selectedPeriod))
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1200))
    const selectedSummary = result.current.result

    // Act: Add an unsynced prior-month record and a row just before chart start.
    const preceding = createSession('preceding', 'analytics-owner', new Date(2026, 3, 20), 300)
    const beforeChart = createSession('before-chart', 'analytics-owner', new Date(2025, 11, 31, 23, 59), 900)
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.bulkAdd([preceding, beforeChart])
        await db.sync_outbox.add({ table_name: 'sessions', action: 'INSERT', payload: preceding, timestamp: selectedTimestamp })
      })
    })

    // Assert: Wider chart context updates, while the selected summary does not.
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)).toMatchObject({ totalSessionSpendCents: 300, sessionCount: 1 }))
    expect(result.current.trend!.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(1500)
    expect(result.current.result).toEqual(selectedSummary)
    expect(await db.sync_outbox.count()).toBe(1)

    // Act: Edit context cost, make it invalid, and recover it through queued local writes.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(preceding.id, { total_cost: 500 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...preceding, total_cost: 500 }, timestamp: selectedTimestamp })
      })
    })
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)?.totalSessionSpendCents).toBe(500))
    expect(result.current.result).toEqual(selectedSummary)

    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(preceding.id, { total_cost: Number.NaN })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...preceding, total_cost: Number.NaN }, timestamp: selectedTimestamp })
      })
    })
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)?.totalSessionSpendCents).toBeNull())
    expect(result.current.result).toEqual(selectedSummary)

    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(preceding.id, { total_cost: 300 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: preceding, timestamp: selectedTimestamp })
      })
    })
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)?.totalSessionSpendCents).toBe(300))
    expect(result.current.result).toEqual(selectedSummary)

    // Act: Move the formerly excluded row onto the inclusive chart start, then before it again.
    await act(async () => { await db.sessions.update(beforeChart.id, { session_timestamp: new Date(2026, 3, 1) }) })
    await waitFor(() => expect(result.current.trend!.buckets[0]).toMatchObject({ totalSessionSpendCents: 1200, sessionCount: 2 }))
    expect(result.current.result).toEqual(selectedSummary)
    await act(async () => { await db.sessions.update(beforeChart.id, { session_timestamp: new Date(2026, 2, 31, 23, 59) }) })
    await waitFor(() => expect(result.current.trend!.buckets[0]).toMatchObject({ totalSessionSpendCents: 300, sessionCount: 1 }))
    expect(result.current.result).toEqual(selectedSummary)

    // Act: Move the preceding row to the inclusive chart start, then to the selected month's exclusive end.
    const chartStart = new Date(2026, 3, 1)
    await act(async () => { await db.sessions.update(preceding.id, { session_timestamp: chartStart }) })
    await waitFor(() => expect(result.current.trend!.buckets[0]).toMatchObject({ totalSessionSpendCents: 300, sessionCount: 1 }))
    await act(async () => { await db.sessions.update(preceding.id, { session_timestamp: new Date(2026, 6, 1) }) })

    // Assert: An exclusive-end timestamp is absent from June and from the chart.
    await waitFor(() => expect(result.current.trend!.buckets[0]).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 0 }))
    await waitFor(() => expect(result.current.trend!.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(1200))
    expect(result.current.trend!.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: 1200, sessionCount: 1 })
    expect(result.current.result).toEqual(selectedSummary)

    // Act: Restore earlier context, then soft-delete it and wait for the live query.
    await act(async () => { await db.sessions.update(preceding.id, { session_timestamp: new Date(2026, 3, 20), deleted_at: undefined }) })
    await waitFor(() => expect(result.current.trend!.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(1500))
    await act(async () => { await db.sessions.update(preceding.id, { session_timestamp: new Date(2026, 3, 20), deleted_at: selectedTimestamp }) })
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 0 }))
    expect(result.current.result).toEqual(selectedSummary)
  })

  it('updates the selected bucket with selected edits and isolates invalid historical context', async () => {
    // Arrange: Keep valid selected-month data beside an invalid earlier record.
    const timestamp = new Date(2026, 5, 10, 12)
    const selected = createSession('selected', 'analytics-owner', timestamp, 1000)
    const invalidContext = createSession('invalid-context', 'analytics-owner', new Date(2026, 3, 10), Number.NaN)
    await db.sessions.bulkAdd([selected, invalidContext])
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const { result } = renderHook(() => useMonthlySessionSpend(period))
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1000))

    // Assert: Invalid context affects only its own bucket.
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)?.totalSessionSpendCents).toBeNull())
    expect(result.current.trend!.buckets.at(-1)?.totalSessionSpendCents).toBe(1000)

    // Act: Edit a selected session locally and queue the write before sync.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(selected.id, { total_cost: 1800, kwh_billed: 15 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...selected, total_cost: 1800, kwh_billed: 15 }, timestamp })
      })
    })

    // Assert: Selected summary and selected chart bucket both reflect the local edit.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 1800, billedEnergyKwh: 15, sessionCount: 1 }))
    expect(result.current.trend!.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: 1800, sessionCount: 1 })
    expect(await db.sync_outbox.count()).toBe(1)
  })

  it('shows a zero selected month while retaining nonempty chart context and recorded free sessions', async () => {
    // Arrange: Prior months include a free session and an older recorded cost with changed pricing metadata.
    const historicalDate = new Date(2026, 3, 8)
    const freeSession = createSession('free', 'analytics-owner', historicalDate, 0)
    const recorded = createSession('recorded', 'analytics-owner', new Date(2026, 4, 8), 750)
    await db.sessions.bulkAdd([freeSession, recorded])
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))

    // Act: Render a month with no sessions while nearby historical months have records.
    const { result } = renderHook(() => useMonthlySessionSpend(period))
    await waitFor(() => expect(result.current.result.isEmpty).toBe(true))

    // Assert: Empty summary and selected bucket remain zero; historical recorded amounts are preserved.
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 4)?.totalSessionSpendCents).toBe(750))
    expect(result.current.result.totalSessionSpendCents).toBe(0)
    expect(result.current.trend!.isEmpty).toBe(false)
    expect(result.current.trend!.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 0 })
    expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 1 })
    expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 4)).toMatchObject({ totalSessionSpendCents: 750, sessionCount: 1 })

    // Act: Change metadata snapshots without changing the historical recorded cost.
    const previousTrend = result.current.trend
    await act(async () => {
      await db.sessions.bulkPut([
        { ...freeSession, applied_session_fee: 500, ad_hoc_pricing: { pricePerKwh: 999 } },
        { ...recorded, applied_session_fee: 450, ad_hoc_pricing: { pricePerKwh: 1 } },
      ])
    })

    // Assert: Chart values continue to use the stored costs, including zero for the free session.
    await waitFor(() => expect(result.current.trend).not.toBe(previousTrend))
    await waitFor(() => expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 4)).toMatchObject({ totalSessionSpendCents: 750, sessionCount: 1 }))
    expect(result.current.trend!.buckets.find((bucket) => bucket.month.month === 3)).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 1 })
    expect(result.current.result.totalSessionSpendCents).toBe(0)
  })

  it('reconciles rolling three-month and year chart ranges with the matching summary', async () => {
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
      ({ period }) => useMonthlySessionSpend(period),
      { initialProps: { period: initialPeriod } },
    )

    // Act and Assert: Both rolling chart ranges match the expected summary and aggregate.
    for (const preset of ['3-months', 'year'] as const) {
      if (preset === 'year') rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset }, now) })
      const expected = preset === '3-months'
        ? { sessionCount: 3, totalSessionSpendCents: 4500 }
        : { sessionCount: 5, totalSessionSpendCents: 7000 }
      await waitFor(() => expect(result.current.result).toMatchObject(expected))
      await waitFor(() => expect(result.current.trend).toMatchObject({ isEmpty: false }))
      const trend = result.current.trend!
      const matchingBuckets = trend.buckets.filter((bucket) => bucket.endUtc > result.current.result.periodStartUtc && bucket.startUtc < result.current.result.periodEndUtc)
      expect(trend.startUtc).toEqual(result.current.result.periodStartUtc)
      expect(trend.endUtc).toEqual(result.current.result.periodEndUtc)
      expect(matchingBuckets.reduce((count, bucket) => count + bucket.sessionCount, 0)).toBe(result.current.result.sessionCount)
      expect(matchingBuckets.reduce((total, bucket) => total + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(result.current.result.totalSessionSpendCents)
    }
  })
})
