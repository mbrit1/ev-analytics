import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, type SyncPayload } from '../../../lib/db'
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
 * Verifies outbox replay, retry preservation on Supabase errors, and initial
 * remote-to-local hydration into Dexie.
 */
describe('syncEngine', () => {
  beforeEach(async () => {
    // Keep each test's outbox/cache state independent inside fake IndexedDB.
    await db.sync_outbox.clear()
    await db.sessions.clear()
    vi.clearAllMocks()
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
})
