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

describe('syncEngine', () => {
  beforeEach(async () => {
    // Keep each test's outbox/cache state independent inside fake IndexedDB.
    await db.sync_outbox.clear()
    await db.sessions.clear()
    vi.clearAllMocks()
  })

  it('should process outbox items and upload to Supabase', async () => {
    // Sessions use the local `sessions` store but sync to Supabase's
    // `charging_sessions` table.
    const session = { id: 's1', user_id: 'u1', total_cost: 100 } as SyncPayload
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date()
    })

    await processOutbox()

    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    
    // Successful uploads are removed so they are not replayed on the next sync.
    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(0)
  })

  it('should not delete outbox item if Supabase returns an error', async () => {
    // Failed uploads remain queued, which turns transient Supabase/network
    // errors into retryable work instead of data loss.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: { message: 'Network Error' } }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 's2' } as SyncPayload,
      timestamp: new Date()
    })

    await processOutbox()

    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(1)
  })

  it('should pull data from Supabase into Dexie during initialSync', async () => {
    // initialSync hydrates local IndexedDB from remote rows using bulkPut so the
    // app can render cached data after startup/login.
    const mockProviders = [
      { id: 'p1', name: 'Ionity', user_id: 'u1', created_at: new Date(), updated_at: new Date() },
      { id: 'p2', name: 'Elli', user_id: 'u1', created_at: new Date(), updated_at: new Date() }
    ]

    const mockSelect = vi.fn(() => Promise.resolve({ data: mockProviders, error: null }))
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>)

    await initialSync()

    const localProviders = await db.providers.toArray()
    expect(localProviders).toHaveLength(2)
    expect(localProviders[0].name).toBe('Ionity')
  })
})
