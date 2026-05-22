import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, type SyncPayload, type Provider, type Tariff, type ChargingSession } from '../../../lib/db'
import { processOutbox, initialSync } from './syncEngine'
import { supabase } from '../../../lib/supabase'
import 'fake-indexeddb/auto'

// Mock Supabase so tests can assert sync behavior without network access.
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null }))
    }))
  }
}))

/**
 * Test suite for the offline sync engine.
 *
 * Verifies ordered outbox replay, retry preservation on Supabase failures,
 * table routing, and initial remote-to-local hydration into Dexie.
 */
describe('syncEngine', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  beforeEach(async () => {
    // Keep each test's outbox/cache state independent inside fake IndexedDB.
    await db.sync_outbox.clear()
    await db.providers.clear()
    await db.tariffs.clear()
    await db.sessions.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
  })

  it('should process outbox items and upload to Supabase', async () => {
    // Arrange: Queue a local session write for sync.
    const session = { id: 's1', user_id: 'u1', total_cost: 100 } as SyncPayload
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Sessions sync to Supabase's charging_sessions table.
    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    
    // Assert: Successful uploads are removed from the outbox.
    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(0)
  })

  it('should process outbox items from oldest to newest', async () => {
    // Arrange: Queue items in insertion order that differs from timestamp order.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'newer' } as SyncPayload,
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'older' } as SyncPayload,
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      }
    ])

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Uploads preserve local mutation chronology.
    expect(mockUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'older' }))
    expect(mockUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'newer' }))
  })

  it('should not delete outbox item if Supabase returns an error', async () => {
    // Arrange: Make Supabase return a retryable sync error.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: { message: 'Network Error' } }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 's2' } as SyncPayload,
      timestamp: new Date()
    })

    // Act: Attempt to process the failing outbox item.
    await processOutbox()

    // Assert: Failed uploads remain queued for a later retry.
    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(1)
  })

  it('should stop processing after the first failed outbox item', async () => {
    // Arrange: Queue two dependent writes and make the first upload fail.
    const mockUpsert = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'Network Error' } })
      .mockResolvedValueOnce({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'blocked-first' } as SyncPayload,
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'blocked-second' } as SyncPayload,
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      }
    ])

    // Act: Attempt to process the outbox.
    await processOutbox()

    // Assert: Later writes are not attempted after an earlier failure.
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const outboxItems = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(outboxItems.map(item => (item.payload as SyncPayload).id)).toEqual(['blocked-first', 'blocked-second'])
  })

  it('should upload provider outbox items to the providers table', async () => {
    // Arrange: Queue a provider mutation for sync.
    const provider = { id: 'p1', user_id: 'u1', name: 'Ionity' } as Provider
    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: provider,
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Provider mutations target the matching Supabase table.
    expect(supabase.from).toHaveBeenCalledWith('providers')
  })

  it('should upload tariff outbox items to the tariffs table', async () => {
    // Arrange: Queue a tariff mutation for sync.
    const tariff = { id: 't1', user_id: 'u1', provider_id: 'p1', tariff_name: 'Drive Free' } as Tariff
    await db.sync_outbox.add({
      table_name: 'tariffs',
      action: 'INSERT',
      payload: tariff,
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Tariff mutations target the matching Supabase table.
    expect(supabase.from).toHaveBeenCalledWith('tariffs')
  })

  it('should sync soft-delete outbox items with their deleted_at payload', async () => {
    // Arrange: Queue a soft-deleted tariff record.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    const deletedAt = new Date('2026-05-21T11:00:00.000Z')
    const tariff = {
      id: 't-deleted',
      user_id: 'u1',
      provider_id: 'p1',
      tariff_name: 'Old tariff',
      deleted_at: deletedAt
    } as Tariff
    await db.sync_outbox.add({
      table_name: 'tariffs',
      action: 'DELETE',
      payload: tariff,
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Deletes are replayed as soft-delete upserts and then removed.
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 't-deleted', deleted_at: deletedAt }))
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('should preserve outbox items when Supabase upload throws unexpectedly', async () => {
    // Arrange: Make the Supabase upload throw instead of returning an error.
    const mockUpsert = vi.fn(() => Promise.reject(new Error('Connection lost')))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 's-throw' } as SyncPayload,
      timestamp: new Date()
    })

    // Act: Attempt to process the outbox.
    await processOutbox()

    // Assert: Thrown failures are retryable and leave the item queued.
    expect(await db.sync_outbox.count()).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unexpected sync failure for table sessions:',
      expect.any(Error)
    )
  })

  it('should record retry metadata and schedule backoff when Supabase returns an error', async () => {
    // Arrange: Make Supabase return a retryable sync error.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const mockUpsert = vi.fn(() => Promise.resolve({ error: { message: 'Network Error' } }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'retry-me' } as SyncPayload,
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })

    // Act: Attempt to process the failing outbox item.
    await processOutbox({ now: () => now })

    // Assert: The failed item stays queued with first retry metadata.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem).toMatchObject({
      retry_count: 1,
      last_attempt_at: now,
      next_attempt_at: new Date('2026-05-21T12:01:00.000Z'),
      last_error: 'Network Error'
    })
  })

  it('should record thrown error messages as retry metadata', async () => {
    // Arrange: Make Supabase throw instead of returning an error object.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const mockUpsert = vi.fn(() => Promise.reject(new Error('Connection lost')))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'throwing-item' } as SyncPayload,
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })

    // Act: Attempt to process the throwing outbox item.
    await processOutbox({ now: () => now })

    // Assert: The thrown message is stored without deleting the item.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.retry_count).toBe(1)
    expect(outboxItem.last_error).toBe('Connection lost')
    expect(outboxItem.next_attempt_at?.toISOString()).toBe('2026-05-21T12:01:00.000Z')
  })

  it('should not process an item whose next retry is scheduled in the future', async () => {
    // Arrange: Queue an item blocked by a future retry time.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'not-yet' } as SyncPayload,
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 1,
      next_attempt_at: new Date('2026-05-21T12:05:00.000Z')
    })

    // Act: Process before the retry window opens.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Future-scheduled items are left untouched.
    expect(mockUpsert).not.toHaveBeenCalled()
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.payload).toEqual({ id: 'not-yet' })
    expect(outboxItem.retry_count).toBe(1)
  })

  it('should pull data from Supabase into Dexie during initialSync', async () => {
    // Arrange: Return provider rows from the mocked Supabase select call.
    const mockProviders = [
      { id: 'p1', name: 'Ionity', user_id: 'u1', created_at: new Date(), updated_at: new Date() },
      { id: 'p2', name: 'Elli', user_id: 'u1', created_at: new Date(), updated_at: new Date() }
    ]

    const mockSelect = vi.fn(() => Promise.resolve({ data: mockProviders, error: null }))
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate local data from Supabase.
    await initialSync()

    // Assert: Remote provider rows are available in Dexie.
    const localProviders = await db.providers.toArray()
    expect(localProviders).toHaveLength(2)
    expect(localProviders[0].name).toBe('Ionity')
  })

  it('should hydrate providers, tariffs, and sessions from their remote tables', async () => {
    // Arrange: Return table-specific rows from Supabase.
    const remoteProviders = [
      { id: 'p1', name: 'Ionity', user_id: 'u1', created_at: new Date(), updated_at: new Date() }
    ] as Provider[]
    const remoteTariffs = [
      { id: 't1', provider_id: 'p1', tariff_name: 'Ionity Passport', user_id: 'u1', created_at: new Date(), updated_at: new Date() }
    ] as Tariff[]
    const remoteSessions = [
      { id: 's1', provider_id: 'p1', tariff_id: 't1', user_id: 'u1', total_cost: 1500, session_timestamp: new Date() }
    ] as ChargingSession[]

    const mockSelect = vi.fn((tableName: string) => {
      if (tableName === 'providers') return Promise.resolve({ data: remoteProviders, error: null })
      if (tableName === 'tariffs') return Promise.resolve({ data: remoteTariffs, error: null })
      if (tableName === 'charging_sessions') return Promise.resolve({ data: remoteSessions, error: null })
      return Promise.resolve({ data: [], error: null })
    })
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => mockSelect(tableName)
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate all local tables from Supabase.
    await initialSync()

    // Assert: Each remote table is requested and written to the matching Dexie table.
    expect(supabase.from).toHaveBeenCalledWith('providers')
    expect(supabase.from).toHaveBeenCalledWith('tariffs')
    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    expect(await db.providers.toArray()).toEqual(remoteProviders)
    expect(await db.tariffs.toArray()).toEqual(remoteTariffs)
    expect(await db.sessions.toArray()).toEqual(remoteSessions)
  })

  it('should continue initialSync when one remote table fails', async () => {
    // Arrange: Make providers fail while tariffs and sessions still return data.
    const remoteTariffs = [
      { id: 't1', provider_id: 'p1', tariff_name: 'Fallback tariff', user_id: 'u1', created_at: new Date(), updated_at: new Date() }
    ] as Tariff[]
    const remoteSessions = [
      { id: 's1', provider_id: 'p1', tariff_id: 't1', user_id: 'u1', total_cost: 1500, session_timestamp: new Date() }
    ] as ChargingSession[]

    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => {
        if (tableName === 'providers') return Promise.resolve({ data: null, error: { message: 'Provider pull failed' } })
        if (tableName === 'tariffs') return Promise.resolve({ data: remoteTariffs, error: null })
        if (tableName === 'charging_sessions') return Promise.resolve({ data: remoteSessions, error: null })
        return Promise.resolve({ data: [], error: null })
      }
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate local data from Supabase.
    await initialSync()

    // Assert: A single table error does not block remaining local hydration.
    expect(await db.providers.count()).toBe(0)
    expect(await db.tariffs.toArray()).toEqual(remoteTariffs)
    expect(await db.sessions.toArray()).toEqual(remoteSessions)
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error pulling data for providers:', 'Provider pull failed')
  })

  it('should keep pending outbox items during initialSync', async () => {
    // Arrange: Queue a local write and return no remote rows.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'pending-local' } as SyncPayload,
      timestamp: new Date()
    })
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => Promise.resolve({ data: [], error: null }))
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate local data from Supabase.
    await initialSync()

    // Assert: Pulling remote data does not discard unsynced local writes.
    const pendingItems = await db.sync_outbox.toArray()
    expect(pendingItems).toHaveLength(1)
    expect((pendingItems[0].payload as SyncPayload).id).toBe('pending-local')
  })
})
