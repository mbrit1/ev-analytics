import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ChargingSession } from '../../../infra/db'
import { useMonthlySessionSpend } from './useMonthlySessionSpend'

vi.mock('../../auth', () => ({ useAuth: () => ({ user: { id: 'analytics-owner' } }) }))

/** Verifies summary updates from real local IndexedDB writes without synchronization. */
describe('monthly summary local reactivity', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })
  afterEach(async () => {
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })

  it('reacts to unsynchronized edits and deletion while excluding another owner', async () => {
    // Arrange: Persist owner-scoped local rows and a pending edit, with no sync runtime.
    const timestamp = new Date(2026, 5, 10)
    const session: ChargingSession = {
      id: 'local-session', user_id: 'analytics-owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 100 },
      session_timestamp: timestamp, provider_name_snapshot: 'Historical provider',
      charging_type: 'AC', kwh_billed: 10, total_cost: 1000,
      applied_session_fee: 0, created_at: timestamp, updated_at: timestamp,
    }
    await db.sessions.bulkPut([session, { ...session, id: 'other-owner', user_id: 'someone-else', total_cost: 9900 }])
    const now = new Date(2026, 6, 1)
    const { result } = renderHook(() => useMonthlySessionSpend({ year: 2026, month: 5 }, now))
    await waitFor(() => expect(result.current.result.totalSessionSpendCents).toBe(1000))

    // Act: Change the local record and queue it without making a network request.
    await act(async () => {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.update(session.id, { total_cost: 2400, kwh_billed: 20 })
        await db.sync_outbox.add({ table_name: 'sessions', action: 'UPDATE', payload: { ...session, total_cost: 2400, kwh_billed: 20 }, timestamp })
      })
    })

    // Assert: The summary reacts to pending local values and excludes other owners.
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 2400, billedEnergyKwh: 20, averageSessionPriceCtPerKwh: 120, sessionCount: 1 }))
    expect(await db.sync_outbox.count()).toBe(1)
    await act(async () => { await db.sessions.update(session.id, { deleted_at: timestamp }) })
    await waitFor(() => expect(result.current.result).toMatchObject({ totalSessionSpendCents: 0, isEmpty: true, averageSessionPriceCtPerKwh: null }))
  })
})
