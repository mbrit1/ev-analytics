import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, type SyncPayload } from '../../../lib/db'
import { processOutbox, initialSync } from './syncEngine'
import { supabase } from '../../../lib/supabase'
import 'fake-indexeddb/auto'

// Mock Supabase
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null }))
    }))
  }
}))

describe('syncEngine', () => {
  beforeEach(async () => {
    await db.sync_outbox.clear()
    await db.sessions.clear()
    vi.clearAllMocks()
  })

  it('should process outbox items and upload to Supabase', async () => {
    // 1. Add item to outbox
    const session = { id: 's1', user_id: 'u1', total_cost: 100 } as SyncPayload
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date()
    })

    // 2. Process outbox
    await processOutbox()

    // 3. Verify Supabase was called
    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    
    // 4. Verify outbox is empty on success
    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(0)
  })

  it('should not delete outbox item if Supabase returns an error', async () => {
    // 1. Mock Supabase failure
    const mockUpsert = vi.fn(() => Promise.resolve({ error: { message: 'Network Error' } }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    // 2. Add item to outbox
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 's2' } as SyncPayload,
      timestamp: new Date()
    })

    // 3. Process outbox
    await processOutbox()

    // 4. Verify item still in outbox
    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(1)
  })

  it('should pull data from Supabase into Dexie during initialSync', async () => {
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
