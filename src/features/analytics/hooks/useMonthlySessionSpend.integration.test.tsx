import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ChargingSession } from '../../../infra/db'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { useMonthlySessionSpend } from './useMonthlySessionSpend'

vi.mock('../../auth', () => ({ useAuth: () => ({ user: { id: 'analytics-owner' } }) }))

/** Verifies selected-period aggregation and local edits without synchronization. */
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
    const session: ChargingSession = {
      id: 'local-session', user_id: 'analytics-owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 100 },
      session_timestamp: timestamp, provider_name_snapshot: 'Historical provider',
      charging_type: 'AC', kwh_billed: 10, total_cost: 1000,
      applied_session_fee: 0, created_at: timestamp, updated_at: timestamp,
    }
    const earlierSession = { ...session, id: 'earlier-local-session', session_timestamp: new Date(2026, 5, 1), total_cost: 500, kwh_billed: 5 }
    await db.sessions.bulkPut([session, earlierSession, { ...session, id: 'other-owner', user_id: 'someone-else', total_cost: 9900 }])
    const monthPeriodNow = new Date(2026, 6, 1)
    const now = new Date(2026, 5, 10, 8)
    const { result, rerender } = renderHook(
      ({ period }) => useMonthlySessionSpend(period),
      { initialProps: { period: createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, monthPeriodNow) } },
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
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now) })
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
    await act(async () => { await db.sessions.update(session.id, { deleted_at: timestamp }) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 0, isEmpty: true, averageSessionPriceCtPerKwh: null }))
    rerender({ period: createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, now) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 500, billedEnergyKwh: 5, sessionCount: 1 }))
  })
})
