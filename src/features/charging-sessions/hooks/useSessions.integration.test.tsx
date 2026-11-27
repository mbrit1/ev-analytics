import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ChargingSession } from '../../../infra/db'
import * as sessionService from '../services/sessionService'
import { useSessions } from './useSessions'

let currentUser: { id: string } | null = { id: 'retry-owner' }

vi.mock('../../auth', () => ({ useAuth: () => ({ user: currentUser }) }))

function createSession(id: string): Extract<ChargingSession, { session_mode: 'ad_hoc' }> {
  const timestamp = new Date('2026-06-10T12:00:00.000Z')
  return {
    id,
    user_id: 'retry-owner',
    session_mode: 'ad_hoc',
    provider_id: null,
    tariff_plan_id: null,
    plan_selection_id: null,
    pricing_context: 'ad_hoc',
    ad_hoc_pricing: { pricePerKwh: 100 },
    session_timestamp: timestamp,
    provider_name_snapshot: 'Historical provider',
    charging_type: 'AC',
    kwh_billed: 10,
    total_cost: 1000,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** Exercises explicit retry through the real Dexie live-query subscription. */
describe('useSessions live-query retry', () => {
  beforeEach(async () => {
    currentUser = { id: 'retry-owner' }
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })

  it('reruns a failed local session read and exposes the recovered Dexie rows', async () => {
    // Arrange: Keep the real Dexie-backed read for the retry after one transient failure.
    const session = createSession('recovered-session')
    await db.sessions.add(session)
    const readSessions = sessionService.getSessions
    const getSessions = vi.spyOn(sessionService, 'getSessions')
      .mockRejectedValueOnce(new Error('Transient local read failure'))
      .mockImplementation(readSessions)
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))

    // Act: Request a new execution of the session live query.
    act(() => result.current.retry())

    // Assert: The new live-query execution recovers the actual owner-scoped row.
    await waitFor(() => expect(result.current.sessions.map(({ id }) => id)).toEqual([session.id]))
    expect(getSessions).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('reruns a failed local session read and preserves the error when retry also fails', async () => {
    // Arrange: Make both the initial and retried local reads fail independently.
    const initialError = new Error('Initial local read failure')
    const retryError = new Error('Retry local read failure')
    const getSessions = vi.spyOn(sessionService, 'getSessions')
      .mockRejectedValueOnce(initialError)
      .mockRejectedValueOnce(retryError)
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.error).toBe(initialError))

    // Act: Request another execution while the local database remains unavailable.
    act(() => result.current.retry())

    // Assert: The latest failed execution remains distinguishable from empty data.
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.error).toBe(retryError))
    expect(result.current.sessions).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('hides an older same-user result when a newer retry read settles first', async () => {
    // Arrange: Leave the first live-query read pending while the retry returns current Dexie rows.
    const olderRead = createDeferred<ChargingSession[]>()
    const recoveredSession = createSession('newer-retry-session')
    await db.sessions.add(recoveredSession)
    const getSessions = vi.spyOn(sessionService, 'getSessions')
      .mockReturnValueOnce(olderRead.promise)
      .mockResolvedValueOnce([recoveredSession])
    const outboxWhere = vi.spyOn(db.sync_outbox, 'where')
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(outboxWhere).toHaveBeenCalled())
    const initialOutboxReadCount = outboxWhere.mock.calls.length

    // Act: Start a newer session read and then complete the older read late.
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.sessions.map(({ id }) => id)).toEqual([recoveredSession.id]))
    await act(async () => {
      olderRead.resolve([createSession('stale-retry-session')])
    })

    // Assert: A result from the prior revision cannot replace the current user's newer result.
    expect(result.current.sessions.map(({ id }) => id)).toEqual([recoveredSession.id])
    expect(result.current.error).toBeNull()
    expect(outboxWhere).toHaveBeenCalledTimes(initialOutboxReadCount)
  })
})
