import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearLocalUserData,
  db,
  type Provider,
  type ChargingPlan,
  type ChargingSession,
  type ProviderPlanSelection,
  type SyncOutbox
} from '../../../infra/db'
import { processOutbox, initialSync } from './syncEngine'
import { supabase } from '../../../infra/supabase'
import 'fake-indexeddb/auto'
import { createSuccessorTariffVersion, scheduleTemporaryPromotion, setActivePlanSelection } from '../../charging-plans'
import { saveSession } from '../../charging-sessions'

const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`)

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  const now = new Date('2026-05-21T00:00:00.000Z')
  return {
    id: 'provider-default',
    user_id: 'user-1',
    name: 'Ionity',
    created_at: now,
    updated_at: now,
    ...overrides
  }
}

function buildChargingPlan(overrides: Partial<ChargingPlan> = {}): ChargingPlan {
  const now = new Date('2026-05-21T00:00:00.000Z')
  return {
    id: 'plan-default',
    user_id: 'user-1',
    provider_id: 'provider-default',
    name: 'Default Plan',
    valid_from: new Date(),
          valid_to: null,
    ac_price_per_kwh: 49, dc_price_per_kwh: 79 ,
      monthly_base_fee: 0,
      session_fee: 0,
    created_at: now,
    updated_at: now,
    ...overrides
  }
}

function buildPrices(overrides: Partial<{
  ac_price_per_kwh: number
  dc_price_per_kwh: number
  roaming_ac_price_per_kwh: number
  roaming_dc_price_per_kwh: number
  monthly_base_fee: number
  session_fee: number
}> = {}) {
  return {
    monthly_base_fee: 0,
    session_fee: 0,
    ...overrides,
  }
}

function normalizePlanDate(value: Date | null | undefined): number {
  return value == null ? Number.POSITIVE_INFINITY : value.getTime()
}

function hasRemoteOverlap(candidate: ChargingPlan, remotePlans: ChargingPlan[]): boolean {
  return remotePlans.some((remotePlan) => {
    if (remotePlan.id === candidate.id || remotePlan.deleted_at) {
      return false
    }

    if (
      remotePlan.user_id !== candidate.user_id
      || remotePlan.provider_id !== candidate.provider_id
      || remotePlan.name.trim().toLowerCase() !== candidate.name.trim().toLowerCase()
    ) {
      return false
    }

    return candidate.valid_from.getTime() < normalizePlanDate(remotePlan.valid_to)
      && remotePlan.valid_from.getTime() < normalizePlanDate(candidate.valid_to)
  })
}

type SessionOverrides =
  | Partial<Extract<ChargingSession, { session_mode: 'plan' }>>
  | Partial<Extract<ChargingSession, { session_mode: 'ad_hoc' }>>

function buildChargingSession(overrides: SessionOverrides = {}): ChargingSession {
  const now = new Date('2026-05-21T00:00:00.000Z')
  return {
    id: 'session-default',
    user_id: 'user-1',
    session_timestamp: new Date('2026-05-21T12:00:00.000Z'),
    provider_id: 'provider-default',
    provider_name_snapshot: 'Ionity',
    tariff_plan_id: 'plan-default',
    charging_plan_name_snapshot: 'Default Plan',
    charging_type: 'DC',
    kwh_billed: 10,
    total_cost: 790,
    session_mode: 'plan',
    applied_dc_price_per_kwh: 79,
    applied_session_fee: 0,
    created_at: now,
    updated_at: now,
    ...overrides
  } as unknown as ChargingSession
}

function buildAdHocChargingSession(
  overrides: Partial<Extract<ChargingSession, { session_mode: 'ad_hoc' }>> = {}
): Extract<ChargingSession, { session_mode: 'ad_hoc' }> {
  const now = new Date('2026-05-21T00:00:00.000Z')
  return {
    id: 'ad-hoc-session-default',
    user_id: 'user-1',
    session_timestamp: new Date('2026-05-21T12:00:00.000Z'),
    provider_id: null,
    provider_name_snapshot: 'Cariqa',
    tariff_plan_id: null,
    charging_plan_name_snapshot: null,
    charging_type: 'DC',
    kwh_billed: 10,
    total_cost: 590,
    session_mode: 'ad_hoc',
    plan_selection_id: null,
    pricing_context: 'ad_hoc',
    ad_hoc_pricing: { cpoName: 'TEAG', pricePerKwh: 59 },
    applied_price_per_kwh: 59,
    applied_session_fee: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function buildProviderPlanSelection(overrides: Partial<ProviderPlanSelection> = {}): ProviderPlanSelection {
  const now = new Date('2026-05-21T00:00:00.000Z')
  return {
    id: 'pps-default',
    user_id: 'user-1',
    provider_id: 'provider-default',
    tariff_plan_id: 'plan-default',
    valid_from: new Date('2026-05-21T00:00:00.000Z'),
    valid_to: null,
    price_snapshot: { label: 'Default Snapshot', kWhPrice: 79 },
    created_at: now,
    updated_at: now,
    ...overrides
  }
}

type SyncOutboxWithFailureKind = SyncOutbox & {
  failure_kind?: 'provider-name-conflict';
};

// Mock Supabase so tests can assert sync behavior without network access.
vi.mock('../../../infra/supabase', () => ({
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
    await db.charging_plans.clear()
    await db.provider_plan_selections.clear()
    await db.sessions.clear()
    vi.clearAllMocks()
    vi.mocked(supabase.from).mockReset()
    vi.mocked(supabase.from).mockImplementation(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null }))
    }) as unknown as ReturnType<typeof supabase.from>)
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
  })

  it('should process outbox items and upload to Supabase', async () => {
    // Arrange: Queue a local session write for sync.
    const session = buildChargingSession({ id: 's1', user_id: 'u1', total_cost: 100 })
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

  it('stops an active outbox pass without later items or local bookkeeping after disposal', async () => {
    // Arrange: Queue two ordered writes and keep the first remote upload pending.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'active-upload' }),
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'later-upload' }),
        timestamp: new Date('2026-05-21T10:01:00.000Z')
      }
    ])
    let resolveFirstUpload: (() => void) | undefined
    const mockUpsert = vi.fn((payload: { id: string }) => {
      if (payload.id === 'active-upload') {
        return new Promise<{ error: null }>((resolve) => {
          resolveFirstUpload = () => resolve({ error: null })
        })
      }
      return Promise.resolve({ error: null })
    })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const abortController = new AbortController()

    // Act: Abort while the first upload is active, then let its response finish.
    const processingPromise = processOutbox({ signal: abortController.signal })
    await vi.waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledTimes(1)
    })
    abortController.abort()
    resolveFirstUpload?.()
    await processingPromise

    // Assert: Neither deletion/retry bookkeeping nor the later upload executes.
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const remainingItems = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(remainingItems.map((item) => item.payload.id)).toEqual(['active-upload', 'later-upload'])
    expect(remainingItems[0]).not.toHaveProperty('last_attempt_at')
    expect(remainingItems[0]).not.toHaveProperty('next_attempt_at')
    expect(remainingItems[0]).not.toHaveProperty('last_error')
  })

  it('strips legacy pricing_context before uploading sessions', async () => {
    // Arrange: Queue a legacy session payload that still contains pricing_context.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({
        id: 'legacy-session',
        pricing_context: 'roaming'
      }),
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Remote payload omits local-only legacy compatibility columns.
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ pricing_context: expect.anything() })
    )
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('should process outbox items from oldest to newest', async () => {
    // Arrange: Queue items in insertion order that differs from timestamp order.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'newer' }),
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'older' }),
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
      payload: buildChargingSession({ id: 's2' }),
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
        payload: buildChargingSession({ id: 'blocked-first' }),
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'blocked-second' }),
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      }
    ])

    // Act: Attempt to process the outbox.
    await processOutbox()

    // Assert: Later writes are not attempted after an earlier failure.
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const outboxItems = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(outboxItems.map(item => item.payload.id)).toEqual(['blocked-first', 'blocked-second'])
  })

  it('should upload provider outbox items to the providers table', async () => {
    // Arrange: Queue a provider mutation for sync.
    const provider = buildProvider({ id: 'p1', user_id: 'u1', name: 'Ionity' })
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

  it('uploads only writable provider fields', async () => {
    // Arrange: Queue a provider payload carrying extra non-domain fields.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const provider = buildProvider({ id: 'provider-allowlist' })

    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'UPDATE',
      payload: {
        ...provider,
        unexpected_remote_flag: true as unknown,
      } as Provider,
      timestamp: new Date()
    })

    // Act: Process the outbox item.
    await processOutbox()

    // Assert: Uploads rebuild providers from the writable column contract.
    expect(mockUpsert).toHaveBeenCalledWith({
      id: provider.id,
      user_id: provider.user_id,
      name: provider.name,
      created_at: provider.created_at,
      updated_at: provider.updated_at,
      deleted_at: provider.deleted_at,
    })
  })

  it('should upload charging plan outbox items to the charging_plans table', async () => {
    // Arrange: Queue a charging plan mutation for sync.
    const plan = buildChargingPlan({ id: 'cp1', user_id: 'u1', provider_id: 'p1', name: 'Drive Free' })
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: plan,
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Charging-plan mutations target the matching Supabase table.
    expect(supabase.from).toHaveBeenCalledWith('charging_plans')
  })

  it('uploads only writable charging plan fields', async () => {
    // Arrange: Queue a charging plan payload that was cloned from a Supabase-hydrated row.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const plan = buildChargingPlan({ id: 'generated-column-plan' })

    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'UPDATE',
      payload: {
        ...plan,
        valid_period: '[2026-01-01,infinity)' as unknown,
        unexpected_remote_flag: true as unknown,
      } as ChargingPlan,
      timestamp: new Date()
    })

    // Act: Process the outbox item.
    await processOutbox()

    // Assert: Uploads rebuild the payload from writable columns instead of replaying arbitrary fields.
    expect(mockUpsert).toHaveBeenCalledWith({
      id: plan.id,
      user_id: plan.user_id,
      provider_id: plan.provider_id,
      name: plan.name,
      valid_from: plan.valid_from,
      valid_to: plan.valid_to,
      ac_price_per_kwh: plan.ac_price_per_kwh,
      dc_price_per_kwh: plan.dc_price_per_kwh,
      roaming_ac_price_per_kwh: plan.roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh: plan.roaming_dc_price_per_kwh,
      monthly_base_fee: plan.monthly_base_fee,
      session_fee: plan.session_fee,
      affiliation: plan.affiliation,
      notes: plan.notes,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
      deleted_at: plan.deleted_at,
    })
  })

  it('should upload provider plan selection outbox items to provider_plan_selections', async () => {
    // Arrange: Queue a provider-plan-selection mutation for sync.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const selection = buildProviderPlanSelection({ id: 'pps-1' })
    await db.sync_outbox.add({
      table_name: 'provider_plan_selections',
      action: 'INSERT',
      payload: selection,
      timestamp: new Date()
    })

    // Act
    await processOutbox()

    // Assert
    expect(supabase.from).toHaveBeenCalledWith('provider_plan_selections')
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('uploads only writable provider plan selection fields', async () => {
    // Arrange: Queue a provider-plan-selection payload carrying extra fields.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const selection = buildProviderPlanSelection({ id: 'pps-allowlist' })

    await db.sync_outbox.add({
      table_name: 'provider_plan_selections',
      action: 'UPDATE',
      payload: {
        ...selection,
        unexpected_remote_flag: true as unknown,
      } as ProviderPlanSelection,
      timestamp: new Date()
    })

    // Act: Process the outbox item.
    await processOutbox()

    // Assert: Uploads rebuild selections from the writable column contract.
    expect(mockUpsert).toHaveBeenCalledWith({
      id: selection.id,
      user_id: selection.user_id,
      provider_id: selection.provider_id,
      tariff_plan_id: selection.tariff_plan_id,
      valid_from: selection.valid_from,
      valid_to: selection.valid_to,
      price_snapshot: selection.price_snapshot,
      created_at: selection.created_at,
      updated_at: selection.updated_at,
      deleted_at: selection.deleted_at,
    })
  })

  it('should sync soft-delete outbox items with their deleted_at payload', async () => {
    // Arrange: Queue a soft-deleted charging plan record.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    const deletedAt = new Date('2026-05-21T11:00:00.000Z')
    const plan = buildChargingPlan({
      id: 'cp-deleted',
      user_id: 'u1',
      provider_id: 'p1',
      name: 'Old charging plan',
      deleted_at: deletedAt
    })
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'DELETE',
      payload: plan,
      timestamp: new Date()
    })

    // Act: Process the outbox.
    await processOutbox()

    // Assert: Deletes are replayed as soft-delete upserts and then removed.
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'cp-deleted', deleted_at: deletedAt }))
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('should preserve outbox items when Supabase upload throws unexpectedly', async () => {
    // Arrange: Make the Supabase upload throw instead of returning an error.
    const mockUpsert = vi.fn(() => Promise.reject(new Error('Connection lost')))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 's-throw' }),
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
      payload: buildChargingSession({ id: 'retry-me' }),
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

  it('should record retry metadata for charging_plans failures', async () => {
    // Arrange: Make charging-plan upload fail with a retryable Supabase error.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const mockUpsert = vi.fn(() => Promise.resolve({ error: { message: 'Charging-plan network error' } }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: buildChargingPlan({ id: 'cp-retry-1' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })

    // Act: Attempt to process the failing outbox item.
    await processOutbox({ now: () => now })

    // Assert: Retry metadata is written and item remains queued.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem).toMatchObject({
      retry_count: 1,
      last_attempt_at: now,
      next_attempt_at: new Date('2026-05-21T12:01:00.000Z'),
      last_error: 'Charging-plan network error'
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
      payload: buildChargingSession({ id: 'throwing-item' }),
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
      payload: buildChargingSession({ id: 'not-yet' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 1,
      next_attempt_at: new Date('2026-05-21T12:05:00.000Z')
    })

    // Act: Process before the retry window opens.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Future-scheduled items are left untouched.
    expect(mockUpsert).not.toHaveBeenCalled()
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.payload).toMatchObject({ id: 'not-yet' })
    expect(outboxItem.retry_count).toBe(1)
  })

  it('should continue scanning and process ready items after delayed items', async () => {
    // Arrange: First item is delayed, second item is ready now.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'delayed-first' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z'),
        retry_count: 1,
        next_attempt_at: new Date('2026-05-21T12:05:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'ready-second' }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      }
    ])

    // Act: Process at a time where only the second item is eligible.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Eligible later items are processed, delayed item remains queued.
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'ready-second' }))
    const remaining = await db.sync_outbox.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].payload.id).toBe('delayed-first')
  })

  it('should leave a ready tariff untouched while its provider insert is retry-delayed', async () => {
    // Arrange: Queue a delayed provider insert before its ready dependent tariff.
    const providerUpsert = vi.fn(() => Promise.resolve({ error: null }))
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'providers') {
        return { upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: buildProvider({ id: 'provider-delayed' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z'),
        retry_count: 1,
        last_attempt_at: new Date('2026-05-21T11:55:00.000Z'),
        next_attempt_at: new Date('2026-05-21T12:05:00.000Z'),
        last_error: 'Provider network error'
      },
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({
          id: 'plan-waiting-for-provider',
          provider_id: 'provider-delayed'
        }),
        timestamp: new Date('2026-05-21T11:01:00.000Z'),
        retry_count: 0
      }
    ])

    // Act: Process while the provider retry window is still closed.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Neither row is attempted and the tariff receives no failure metadata.
    expect(providerUpsert).not.toHaveBeenCalled()
    expect(chargingPlanUpsert).not.toHaveBeenCalled()
    const remaining = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(remaining).toHaveLength(2)
    expect(remaining[1]).toMatchObject({
      table_name: 'charging_plans',
      retry_count: 0
    })
    expect(remaining[1].last_attempt_at).toBeUndefined()
    expect(remaining[1].next_attempt_at).toBeUndefined()
    expect(remaining[1].last_error).toBeUndefined()
  })

  it('should upload a tariff after its provider succeeds earlier in the same pass', async () => {
    // Arrange: Queue one ready provider insert followed by its dependent tariff.
    const uploadOrder: string[] = []
    const providerUpsert = vi.fn(() => {
      uploadOrder.push('providers')
      return Promise.resolve({ error: null })
    })
    const chargingPlanUpsert = vi.fn(() => {
      uploadOrder.push('charging_plans')
      return Promise.resolve({ error: null })
    })
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'providers') {
        return { upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: buildProvider({ id: 'provider-ready' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      },
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({
          id: 'plan-ready-after-provider',
          provider_id: 'provider-ready'
        }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      }
    ])

    // Act: Process both ready dependency-ordered rows.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Provider success releases the tariff later in the same pass.
    expect(uploadOrder).toEqual(['providers', 'charging_plans'])
    expect(await db.sync_outbox.count()).toBe(0)
  })
  it.each([
    {
      description: 'a provider insert blocks a charging-plan INSERT',
      parentTable: 'providers' as const,
      parentPayload: () => buildProvider({ id: 'pending-provider' }),
      childTable: 'charging_plans' as const,
      childAction: 'INSERT' as const,
      childPayload: () => buildChargingPlan({
        id: 'pending-provider-plan',
        provider_id: 'pending-provider',
      }),
    },
    {
      description: 'a provider insert blocks a selection UPDATE',
      parentTable: 'providers' as const,
      parentPayload: () => buildProvider({ id: 'pending-provider' }),
      childTable: 'provider_plan_selections' as const,
      childAction: 'UPDATE' as const,
      childPayload: () => buildProviderPlanSelection({
        id: 'pending-provider-selection',
        provider_id: 'pending-provider',
      }),
    },
    {
      description: 'a provider insert blocks a session soft-delete',
      parentTable: 'providers' as const,
      parentPayload: () => buildProvider({ id: 'pending-provider' }),
      childTable: 'sessions' as const,
      childAction: 'DELETE' as const,
      childPayload: () => buildChargingSession({
        id: 'pending-provider-session',
        provider_id: 'pending-provider',
      }),
    },
    {
      description: 'a charging-plan insert blocks a selection INSERT',
      parentTable: 'charging_plans' as const,
      parentPayload: () => buildChargingPlan({ id: 'pending-plan' }),
      childTable: 'provider_plan_selections' as const,
      childAction: 'INSERT' as const,
      childPayload: () => buildProviderPlanSelection({
        id: 'pending-plan-selection',
        tariff_plan_id: 'pending-plan',
      }),
    },
    {
      description: 'a charging-plan insert blocks a session UPDATE',
      parentTable: 'charging_plans' as const,
      parentPayload: () => buildChargingPlan({ id: 'pending-plan' }),
      childTable: 'sessions' as const,
      childAction: 'UPDATE' as const,
      childPayload: () => buildChargingSession({
        id: 'pending-plan-session',
        tariff_plan_id: 'pending-plan',
        plan_selection_id: null,
      }),
    },
    {
      description: 'a selection insert blocks a session soft-delete',
      parentTable: 'provider_plan_selections' as const,
      parentPayload: () => buildProviderPlanSelection({ id: 'pending-selection' }),
      childTable: 'sessions' as const,
      childAction: 'DELETE' as const,
      childPayload: () => buildChargingSession({
        id: 'pending-selection-session',
        plan_selection_id: 'pending-selection',
      }),
    },
  ])('$description while the parent is retry-delayed', async ({
    parentTable,
    parentPayload,
    childTable,
    childAction,
    childPayload,
  }) => {
    // Arrange: Leave the parent pending and give the child existing retry metadata.
    const parent = parentPayload()
    const child = childPayload()
    const childRetryMetadata = {
      retry_count: 4,
      last_attempt_at: new Date('2026-05-21T11:55:00.000Z'),
      last_error: 'Previous child failure',
    }
    const childOutboxId = await db.sync_outbox.add({
      table_name: childTable,
      action: childAction,
      payload: child,
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      ...childRetryMetadata,
    })
    await db.sync_outbox.add({
      table_name: parentTable,
      action: 'INSERT',
      payload: parent,
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
      retry_count: 1,
      last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
      next_attempt_at: new Date('2026-05-21T12:05:00.000Z'),
      last_error: 'Parent retry is not ready',
    })
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Process with the parent still outside its retry window.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: The child is untouched, including all retry metadata.
    expect(mockUpsert).not.toHaveBeenCalledWith(expect.objectContaining({ id: child.id }))
    await expect(db.sync_outbox.get(childOutboxId)).resolves.toMatchObject(childRetryMetadata)
  })

  it.each([
    {
      description: 'a provider insert blocks a selection INSERT',
      parentTable: 'providers' as const,
      parentPayload: () => buildProvider({ id: 'terminal-provider' }),
      childTable: 'provider_plan_selections' as const,
      childAction: 'INSERT' as const,
      childPayload: () => buildProviderPlanSelection({
        id: 'terminal-provider-selection',
        provider_id: 'terminal-provider',
      }),
      parentFailure: {
        last_error: 'Provider name already exists remotely (active, case-insensitive)',
        failure_kind: 'provider-name-conflict' as const,
      },
    },
    {
      description: 'a charging-plan insert blocks a session UPDATE',
      parentTable: 'charging_plans' as const,
      parentPayload: () => buildChargingPlan({ id: 'terminal-plan' }),
      childTable: 'sessions' as const,
      childAction: 'UPDATE' as const,
      childPayload: () => buildChargingSession({
        id: 'terminal-plan-session',
        tariff_plan_id: 'terminal-plan',
        plan_selection_id: null,
      }),
      parentFailure: {
        last_error: 'Tariff validity overlaps with an existing active version for this provider and name',
      },
    },
    {
      description: 'a selection insert blocks a session soft-delete',
      parentTable: 'provider_plan_selections' as const,
      parentPayload: () => buildProviderPlanSelection({ id: 'terminal-selection' }),
      childTable: 'sessions' as const,
      childAction: 'DELETE' as const,
      childPayload: () => buildChargingSession({
        id: 'terminal-selection-session',
        plan_selection_id: 'terminal-selection',
      }),
      parentFailure: {
        last_error: 'Permanent selection failure',
      },
    },
  ])('$description while the parent is terminal', async ({
    parentTable,
    parentPayload,
    childTable,
    childAction,
    childPayload,
    parentFailure,
  }) => {
    // Arrange: Persist a terminal parent insert before its dependent mutation.
    const parent = parentPayload()
    const child = childPayload()
    const childOutboxId = await db.sync_outbox.add({
      table_name: childTable,
      action: childAction,
      payload: child,
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 3,
      last_attempt_at: new Date('2026-05-21T11:55:00.000Z'),
      last_error: 'Previous child failure',
    })
    await db.sync_outbox.add({
      table_name: parentTable,
      action: 'INSERT',
      payload: parent,
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
      retry_count: 1,
      last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
      ...parentFailure,
    } as SyncOutbox)
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Process a queue whose parent cannot be retried automatically.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Neither the terminal parent nor its dependent child is uploaded.
    expect(mockUpsert).not.toHaveBeenCalled()
    await expect(db.sync_outbox.get(childOutboxId)).resolves.toMatchObject({
      retry_count: 3,
      last_error: 'Previous child failure',
    })
  })

  it('blocks a selected session on a pending selection but uploads an unselected session whose plan is ready', async () => {
    // Arrange: Keep only the selection pending; both sessions reference the same ready plan.
    const selectedSession = buildChargingSession({
      id: 'selection-dependent-session',
      plan_selection_id: 'selection-pending',
    })
    const unselectedSession = buildChargingSession({
      id: 'plan-only-session',
      plan_selection_id: null,
    })
    const selectedOutboxId = await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: selectedSession,
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 2,
      last_attempt_at: new Date('2026-05-21T11:55:00.000Z'),
      last_error: 'Previous selected-session failure',
    })
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'provider_plan_selections',
        action: 'INSERT',
        payload: buildProviderPlanSelection({ id: 'selection-pending' }),
        timestamp: new Date('2026-05-21T11:01:00.000Z'),
        retry_count: 1,
        last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
        next_attempt_at: new Date('2026-05-21T12:05:00.000Z'),
        last_error: 'Selection retry is not ready',
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: unselectedSession,
        timestamp: new Date('2026-05-21T11:02:00.000Z'),
      },
    ])
    const uploadIds: string[] = []
    const mockUpsert = vi.fn((payload: { id: string }) => {
      uploadIds.push(payload.id)
      return Promise.resolve({ error: null })
    })
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Process while the selection insert remains delayed.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Only the plan-only session uploads and the selected session remains unchanged.
    expect(uploadIds).toEqual(['plan-only-session'])
    await expect(db.sync_outbox.get(selectedOutboxId)).resolves.toMatchObject({
      retry_count: 2,
      last_error: 'Previous selected-session failure',
    })
  })

  it('retains a dependency count when one duplicate parent insert succeeds while another remains pending', async () => {
    // Arrange: Queue duplicate provider inserts followed by a plan insert.
    const provider = buildProvider({ id: 'duplicate-provider' })
    const childPlan = buildChargingPlan({
      id: 'duplicate-provider-plan',
      provider_id: provider.id,
    })
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: provider,
        timestamp: new Date('2026-05-21T11:00:00.000Z'),
      },
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: provider,
        timestamp: new Date('2026-05-21T11:01:00.000Z'),
        retry_count: 1,
        last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
        next_attempt_at: new Date('2026-05-21T12:05:00.000Z'),
        last_error: 'Duplicate provider insert is delayed',
      },
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: childPlan,
        timestamp: new Date('2026-05-21T11:02:00.000Z'),
      },
    ])
    const uploadIds: string[] = []
    const mockUpsert = vi.fn((payload: { id: string }) => {
      uploadIds.push(payload.id)
      return Promise.resolve({ error: null })
    })
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Let the ready duplicate succeed while the second remains delayed.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: The unresolved duplicate continues to block its child.
    expect(uploadIds).toEqual(['duplicate-provider'])
    expect(await db.sync_outbox.where('table_name').equals('charging_plans').count()).toBe(1)
  })

  it('keeps a superseded parent insert blocking descendants despite a later parent update', async () => {
    // Arrange: A terminal plan insert remains ahead of a same-ID update and selection.
    const plan = buildChargingPlan({ id: 'superseded-plan' })
    const selection = buildProviderPlanSelection({
      id: 'superseded-plan-selection',
      tariff_plan_id: plan.id,
    })
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: plan,
        timestamp: new Date('2026-05-21T11:00:00.000Z'),
        retry_count: 1,
        last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
        last_error: 'Tariff validity overlaps with an existing active version for this provider and name',
      },
      {
        table_name: 'charging_plans',
        action: 'UPDATE',
        payload: plan,
        timestamp: new Date('2026-05-21T11:01:00.000Z'),
      },
      {
        table_name: 'provider_plan_selections',
        action: 'INSERT',
        payload: selection,
        timestamp: new Date('2026-05-21T11:02:00.000Z'),
      },
    ])
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Process the terminal insert and its newer mutations.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: The terminal insert keeps both descendants blocked.
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('replays a reversed and tied plan graph to a fixed point in foreign-key order', async () => {
    // Arrange: Queue session, selection, and plan in reverse order with tied timestamps.
    const timestamp = new Date('2026-05-21T11:00:00.000Z')
    const plan = buildChargingPlan({ id: 'fixed-point-plan' })
    const selection = buildProviderPlanSelection({
      id: 'fixed-point-selection',
      tariff_plan_id: plan.id,
    })
    const session = buildChargingSession({
      id: 'fixed-point-session',
      tariff_plan_id: plan.id,
      plan_selection_id: selection.id,
    })
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: session,
        timestamp,
      },
      {
        table_name: 'provider_plan_selections',
        action: 'INSERT',
        payload: selection,
        timestamp,
      },
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: plan,
        timestamp,
      },
    ])
    const uploadTables: string[] = []
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      upsert: vi.fn((payload: { id: string }) => {
        uploadTables.push(`${tableName}:${payload.id}`)
        return Promise.resolve({ error: null })
      }),
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Run one replay pass.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: Deferred children are reconsidered until the graph drains in dependency order.
    expect(uploadTables).toEqual([
      'charging_plans:fixed-point-plan',
      'provider_plan_selections:fixed-point-selection',
      'charging_sessions:fixed-point-session',
    ])
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('reconstructs pending dependency state from the durable outbox on a later pass', async () => {
    // Arrange: Persist a delayed plan and its ready selection.
    const plan = buildChargingPlan({ id: 'reload-plan' })
    const selection = buildProviderPlanSelection({
      id: 'reload-selection',
      tariff_plan_id: plan.id,
    })
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: plan,
        timestamp: new Date('2026-05-21T11:01:00.000Z'),
        retry_count: 1,
        last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
        next_attempt_at: new Date('2026-05-21T12:05:00.000Z'),
        last_error: 'Plan retry is not ready',
      },
      {
        table_name: 'provider_plan_selections',
        action: 'INSERT',
        payload: selection,
        timestamp: new Date('2026-05-21T11:02:00.000Z'),
      },
    ])
    const uploadIds: string[] = []
    const mockUpsert = vi.fn((payload: { id: string }) => {
      uploadIds.push(payload.id)
      return Promise.resolve({ error: null })
    })
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: First pass sees no progress; releasing the parent simulates a reloaded runtime.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })
    const [parent] = await db.sync_outbox.where('table_name').equals('charging_plans').toArray()
    await db.sync_outbox.update(parent.id!, {
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined,
    })
    await processOutbox({ now: () => new Date('2026-05-21T12:06:00.000Z') })

    // Assert: The first pass did not touch the child and the second pass drains both.
    expect(uploadIds).toEqual(['reload-plan', 'reload-selection'])
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('terminates a no-progress pass without retrying terminal parents or descendants', async () => {
    // Arrange: The terminal selection and dependent session cannot make progress.
    const session = buildChargingSession({
      id: 'no-progress-session',
      plan_selection_id: 'no-progress-selection',
    })
    const sessionOutboxId = await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
      retry_count: 5,
      last_attempt_at: new Date('2026-05-21T11:55:00.000Z'),
      last_error: 'Previous session failure',
    })
    await db.sync_outbox.add({
      table_name: 'provider_plan_selections',
      action: 'INSERT',
      payload: buildProviderPlanSelection({ id: 'no-progress-selection' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 1,
      last_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
      last_error: 'Terminal selection failure',
    })
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({
      upsert: mockUpsert,
    } as unknown as ReturnType<typeof supabase.from>)

    // Act: Run repeated passes; a fixed point must terminate deterministically.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })
    await processOutbox({ now: () => new Date('2026-05-21T12:01:00.000Z') })

    // Assert: No item is retried and the child metadata remains unchanged.
    expect(mockUpsert).not.toHaveBeenCalled()
    await expect(db.sync_outbox.get(sessionOutboxId)).resolves.toMatchObject({
      retry_count: 5,
      last_error: 'Previous session failure',
    })
  })


  it('should retain a provider-name conflict, block its tariff, and sync unrelated ready work', async () => {
    // Arrange: Reject the provider with the named remote uniqueness constraint.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const providerUpsert = vi.fn(() => Promise.resolve({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "providers_user_name_active_unique"'
      }
    }))
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({ error: null }))
    const chargingSessionUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'providers') {
        return { upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      if (tableName === 'charging_plans') {
        return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      return { upsert: chargingSessionUpsert } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: buildProvider({ id: 'provider-name-conflict' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      },
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({
          id: 'plan-blocked-by-provider-conflict',
          provider_id: 'provider-name-conflict'
        }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'unrelated-ready-session' }),
        timestamp: new Date('2026-05-21T11:02:00.000Z')
      }
    ])

    // Act: Process the pass containing the terminal provider conflict.
    await processOutbox({ now: () => now })

    // Assert: The conflict is terminal, its tariff is untouched, and unrelated work drains.
    expect(providerUpsert).toHaveBeenCalledTimes(1)
    expect(chargingPlanUpsert).not.toHaveBeenCalled()
    expect(chargingSessionUpsert).toHaveBeenCalledTimes(1)
    const remaining = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(remaining).toHaveLength(2)
    expect(remaining[0]).toMatchObject({
      table_name: 'providers',
      retry_count: 1,
      last_attempt_at: now,
      last_error: 'Provider name already exists remotely (active, case-insensitive)',
      failure_kind: 'provider-name-conflict',
    })
    expect(remaining[0].next_attempt_at).toBeUndefined()
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.any(String),
      'duplicate key value violates unique constraint "providers_user_name_active_unique"',
    )
    expect(remaining[1]).toMatchObject({
      table_name: 'charging_plans'
    })
    expect(remaining[1].retry_count).toBeUndefined()
    expect(remaining[1].last_attempt_at).toBeUndefined()
    expect(remaining[1].next_attempt_at).toBeUndefined()
    expect(remaining[1].last_error).toBeUndefined()
  })

  it('should retain a generic provider sync failure without exposing backend details in outbox metadata', async () => {
    // Arrange: Return an unexpected provider error whose raw detail is diagnostic-only.
    const rawErrorMessage = 'database backend detail for provider sync';
    const providerUpsert = vi.fn(() => Promise.resolve({ error: { message: rawErrorMessage } }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'providers') {
        return { upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      return { upsert: vi.fn(() => Promise.resolve({ error: null })) } as unknown as ReturnType<typeof supabase.from>
    })
    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: 'provider-generic-error' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: Process the unexpected provider failure.
    await processOutbox()

    // Assert: User-facing metadata is stable while the console retains raw diagnostics.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.last_error).toBe('Unable to sync provider. Please try again.')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Sync error for table providers:', rawErrorMessage)
  })

  it('clears a stale provider-name failure kind when a later live error is generic', async () => {
    // Arrange: a new non-conflict response must not preserve a prior typed classification.
    const providerUpsert = vi.fn(() => Promise.resolve({ error: { message: 'temporary gateway failure' } }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      upsert: tableName === 'providers' ? providerUpsert : vi.fn(() => Promise.resolve({ error: null }))
    }) as unknown as ReturnType<typeof supabase.from>)
    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: 'provider-clear-failure-kind' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 1,
      last_attempt_at: new Date('2026-05-21T11:01:00.000Z'),
      next_attempt_at: new Date('2026-05-21T11:59:00.000Z'),
      last_error: 'Provider name already exists remotely (active, case-insensitive)',
      failure_kind: 'provider-name-conflict',
    } as SyncOutboxWithFailureKind)

    // Act: the current remote response is not the recognized uniqueness conflict.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: only the safe generic error remains durable after the attempt.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem).toMatchObject({
      last_error: 'Unable to sync provider. Please try again.',
      next_attempt_at: new Date('2026-05-21T12:02:00.000Z'),
    })
    expect(outboxItem).not.toHaveProperty('failure_kind')
  })

  it.each([
    ['the wrong PostgreSQL code', { code: '23514', message: 'providers_user_name_active_unique', details: 'raw-details', hint: 'raw-hint' }],
    ['the wrong uniqueness constraint', { code: '23505', message: 'other_unique_constraint', details: 'raw-details', hint: 'raw-hint' }],
    ['a non-string message', { code: '23505', message: { constraint: 'providers_user_name_active_unique' }, details: 'raw-details', hint: 'raw-hint' }],
  ])('keeps %s generic without persisting raw PostgreSQL metadata', async (_label, error) => {
    // Arrange: only the exact live uniqueness response may receive durable conflict classification.
    const providerUpsert = vi.fn(() => Promise.resolve({ error }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>)
    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: `near-miss-${String(error.code)}` }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: process the near-miss response.
    await processOutbox()

    // Assert: durable state contains only the generic safe provider failure.
    const [item] = await db.sync_outbox.toArray()
    expect(item).toMatchObject({ last_error: 'Unable to sync provider. Please try again.' })
    expect(item).not.toHaveProperty('failure_kind')
    expect(JSON.stringify(item)).not.toContain('raw-details')
    expect(JSON.stringify(item)).not.toContain('raw-hint')
  })

  it('persists and logs only safe data for the recognized live provider-name conflict', async () => {
    // Arrange: Supabase returns raw PostgreSQL diagnostics that must not survive the known-conflict boundary.
    const providerUpsert = vi.fn(() => Promise.resolve({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "providers_user_name_active_unique"',
        details: 'raw-details',
        hint: 'raw-hint',
        constraint: 'providers_user_name_active_unique',
      },
    }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>)
    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: 'recognized-safe-conflict' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: process the recognized response.
    await processOutbox()

    // Assert: the typed discriminator and safe text replace every raw diagnostic value.
    const [item] = await db.sync_outbox.toArray()
    expect(item).toMatchObject({
      failure_kind: 'provider-name-conflict',
      last_error: 'Provider name already exists remotely (active, case-insensitive)',
      retry_count: 1,
      last_attempt_at: expect.any(Date),
    })
    expect(item.next_attempt_at).toBeUndefined()
    const logText = consoleErrorSpy.mock.calls.flat().map(String).join('\n')
    expect(JSON.stringify(item)).not.toContain('raw-details')
    expect(logText).not.toContain('raw-details')
    expect(logText).not.toContain('raw-hint')
  })

  it('discards a stale successful remote result when the captured outbox row changes', async () => {
    // Arrange: keep the upload unresolved until a local writer replaces its payload and timestamp.
    let resolveUpload: ((result: { error: null }) => void) | undefined
    const providerUpsert = vi.fn(() => new Promise<{ error: null }>((resolve) => {
      resolveUpload = resolve
    }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      upsert: tableName === 'providers' ? providerUpsert : vi.fn(() => Promise.resolve({ error: null }))
    }) as unknown as ReturnType<typeof supabase.from>)
    const outboxId = await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: 'provider-stale-result', name: 'Original' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: mutate the exact row while the remote call is in flight, then resolve it successfully.
    const processing = processOutbox()
    await vi.waitFor(() => expect(providerUpsert).toHaveBeenCalledTimes(1))
    await db.sync_outbox.update(outboxId, {
      payload: buildProvider({ id: 'provider-stale-result', name: 'Replacement' }),
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
    })
    resolveUpload?.({ error: null })
    await processing

    // Assert: a stale acknowledgement may not delete the newer local mutation.
    await expect(db.sync_outbox.get(outboxId)).resolves.toMatchObject({
      payload: expect.objectContaining({ name: 'Replacement' }),
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
    })
  })

  it.each([
    ['table name', (id: number) => db.sync_outbox.update(id, { table_name: 'sessions' as never })],
    ['action', (id: number) => db.sync_outbox.update(id, { action: 'UPDATE' })],
    ['timestamp', (id: number) => db.sync_outbox.update(id, { timestamp: new Date('2026-05-21T11:01:00.000Z') })],
    ['full payload', (id: number) => db.sync_outbox.update(id, { payload: buildProvider({ id: 'stale-full-payload', name: 'Replacement' }) })],
  ])('discards a stale successful result when its attempted %s changes', async (_label, mutate) => {
    // Arrange: hold the remote response while a current-row identity field changes.
    let resolveUpload: ((result: { error: null }) => void) | undefined
    const providerUpsert = vi.fn(() => new Promise<{ error: null }>((resolve) => { resolveUpload = resolve }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>)
    const outboxId = await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: `stale-${_label}` }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: mutate the captured row before the remote success resolves.
    const processing = processOutbox()
    await vi.waitFor(() => expect(providerUpsert).toHaveBeenCalledTimes(1))
    await mutate(outboxId)
    resolveUpload?.({ error: null })
    await processing

    // Assert: no stale acknowledgement may delete or decorate a changed current row.
    await expect(db.sync_outbox.get(outboxId)).resolves.toBeDefined()
  })

  it('discards a stale successful result when another writer deletes the attempted row', async () => {
    // Arrange: the remote response resolves after the local row was intentionally removed.
    let resolveUpload: ((result: { error: null }) => void) | undefined
    const providerUpsert = vi.fn(() => new Promise<{ error: null }>((resolve) => { resolveUpload = resolve }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>)
    const outboxId = await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: 'deleted-stale-row' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: delete the row while the remote request is pending.
    const processing = processOutbox()
    await vi.waitFor(() => expect(providerUpsert).toHaveBeenCalledTimes(1))
    await db.sync_outbox.delete(outboxId)
    resolveUpload?.({ error: null })
    await processing

    // Assert: stale success never recreates a deleted local mutation.
    await expect(db.sync_outbox.get(outboxId)).resolves.toBeUndefined()
  })

  it('should retain a provider constraint failure without exposing backend details in outbox metadata', async () => {
    // Arrange: Return a non-retryable provider constraint error with raw database detail.
    const rawErrorMessage = 'new row violates check constraint "providers_name_contract_check"';
    const providerUpsert = vi.fn(() => Promise.resolve({ error: { code: '23514', message: rawErrorMessage } }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'providers') {
        return { upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      return { upsert: vi.fn(() => Promise.resolve({ error: null })) } as unknown as ReturnType<typeof supabase.from>
    })
    await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: buildProvider({ id: 'provider-constraint-error' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: Process the provider constraint failure.
    await processOutbox()

    // Assert: User-facing metadata remains stable while the console retains raw diagnostics.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.last_error).toBe('Unable to sync provider. Please try again.')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Non-retryable sync validation error for table providers:',
      rawErrorMessage,
    )
  })

  it('should not retry a known terminal provider-name conflict on later passes', async () => {
    // Arrange: Queue a provider conflict and its dependent tariff.
    const providerUpsert = vi.fn(() => Promise.resolve({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "providers_user_name_active_unique"'
      }
    }))
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'providers') {
        return { upsert: providerUpsert } as unknown as ReturnType<typeof supabase.from>
      }
      return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: buildProvider({ id: 'provider-terminal-conflict' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      },
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({
          id: 'plan-still-blocked',
          provider_id: 'provider-terminal-conflict'
        }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      }
    ])

    // Act: Process the original conflict and another pass after a normal retry delay.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })
    await processOutbox({ now: () => new Date('2026-05-21T12:02:00.000Z') })

    // Assert: Neither the terminal provider nor its tariff is reissued.
    expect(providerUpsert).toHaveBeenCalledTimes(1)
    expect(chargingPlanUpsert).not.toHaveBeenCalled()
    expect(await db.sync_outbox.count()).toBe(2)
  })

  it('quarantines an untyped legacy terminal provider insert without resending or retiring it', async () => {
    // Arrange: historical terminal copy is not durable evidence and cannot authorize a resend.
    const providerUpsert = vi.fn(() => Promise.resolve({ error: null }))
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      upsert: tableName === 'providers' ? providerUpsert : chargingPlanUpsert,
    }) as unknown as ReturnType<typeof supabase.from>)
    const legacyProvider = buildProvider({ id: 'legacy-terminal-provider', name: 'Historical name' })
    const repairedProvider = buildProvider({
      id: legacyProvider.id,
      name: 'Renamed after the terminal failure',
    })
    const legacyOutboxId = await db.sync_outbox.add({
      table_name: 'providers',
      action: 'INSERT',
      payload: legacyProvider,
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 1,
      last_attempt_at: new Date('2026-05-21T11:01:00.000Z'),
      next_attempt_at: undefined,
      last_error: 'Historical terminal provider failure',
    })
    const dependentPlanOutboxId = await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: buildChargingPlan({
        id: 'plan-blocked-by-legacy-provider',
        provider_id: legacyProvider.id,
      }),
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
    })
    const updateOutboxId = await db.sync_outbox.add({
      table_name: 'providers',
      action: 'UPDATE',
      payload: repairedProvider,
      timestamp: new Date('2026-05-21T11:02:00.000Z'),
    })

    // Act: a later provider update must not supersede the retained terminal INSERT.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') })

    // Assert: only the independent UPDATE may replay; legacy terminal state stays generic and blocks its plan.
    expect(providerUpsert).toHaveBeenCalledTimes(1)
    expect(providerUpsert).toHaveBeenCalledWith(expect.objectContaining(repairedProvider))
    expect(chargingPlanUpsert).not.toHaveBeenCalled()
    await expect(db.sync_outbox.get(legacyOutboxId)).resolves.toEqual(expect.objectContaining({
      payload: legacyProvider,
      last_error: 'Historical terminal provider failure',
    }))
    expect(await db.sync_outbox.get(legacyOutboxId)).not.toHaveProperty('failure_kind')
    await expect(db.sync_outbox.get(dependentPlanOutboxId)).resolves.toBeDefined()
    await expect(db.sync_outbox.get(updateOutboxId)).resolves.toBeUndefined()
  })

  it('should keep unknown table_name items queued with retry metadata', async () => {
    // Arrange: Insert an outbox row with an unsupported table name.
    const now = new Date('2026-05-21T12:00:00.000Z')
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 'unknown-table-item' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })
    const [row] = await db.sync_outbox.toArray()
    await db.sync_outbox.update(row.id!, { table_name: 'unknown_table' as never })

    // Act: Process the outbox.
    await processOutbox({ now: () => now })

    // Assert: Unsupported table names are treated as failures.
    expect(supabase.from).not.toHaveBeenCalled()
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem).toMatchObject({
      retry_count: 1,
      last_attempt_at: now,
      next_attempt_at: new Date('2026-05-21T12:01:00.000Z'),
      last_error: 'Unsupported sync table: unknown_table'
    })
  })

  it('supports every declared SyncOutbox table_name and drains successful rows', async () => {
    // Arrange: Queue one row for each supported table_name.
    const entries: Array<{ table: SyncOutbox['table_name']; payload: SyncOutbox['payload'] }> = [
      { table: 'providers', payload: buildProvider({ id: 'contract-provider' }) },
      { table: 'charging_plans', payload: buildChargingPlan({ id: 'contract-plan' }) },
      { table: 'provider_plan_selections', payload: buildProviderPlanSelection({ id: 'contract-pps' }) },
      { table: 'sessions', payload: buildChargingSession({ id: 'contract-session' }) }
    ]
    await db.sync_outbox.bulkAdd(
      entries.map((entry, index) => ({
        table_name: entry.table,
        action: 'INSERT',
        payload: entry.payload,
        timestamp: new Date(`2026-05-21T10:0${index}:00.000Z`)
      }))
    )

    // Act
    await processOutbox()

    // Assert: All known tables route successfully and queue drains.
    expect(supabase.from).toHaveBeenCalledWith('providers')
    expect(supabase.from).toHaveBeenCalledWith('charging_plans')
    expect(supabase.from).toHaveBeenCalledWith('provider_plan_selections')
    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('processes provider_plan_selections before sessions without blocking on unsupported-table errors', async () => {
    // Arrange: Queue provider-plan-selection first, then a session.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'provider_plan_selections',
        action: 'INSERT',
        payload: buildProviderPlanSelection({ id: 'pps-before-session' }),
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-after-pps' }),
        timestamp: new Date('2026-05-21T09:01:00.000Z')
      }
    ])

    // Act
    await processOutbox()

    // Assert
    expect(supabase.from).toHaveBeenNthCalledWith(1, 'provider_plan_selections')
    expect(supabase.from).toHaveBeenNthCalledWith(2, 'charging_sessions')
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('drains outbox for real plan-selection + session service flow', async () => {
    // Arrange: Create real outbox rows via service calls.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const now = new Date('2026-05-21T12:00:00.000Z')
    await db.providers.add(buildProvider())

    const selection = await setActivePlanSelection({
      userId: 'user-1',
      providerId: 'provider-default',
      tariffPlanId: 'plan-default',
      validFrom: now,
      priceSnapshot: { label: 'Default Snapshot', kWhPrice: 79 }
    })

    await saveSession(
      buildChargingSession({
        id: 'service-flow-session',
        user_id: 'user-1',
        provider_id: 'provider-default',
        tariff_plan_id: 'plan-default',
        plan_selection_id: selection.id
      })
    )

    // Act
    await processOutbox()

    // Assert
    expect(supabase.from).toHaveBeenCalledWith('provider_plan_selections')
    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('uploads only writable charging session fields', async () => {
    // Arrange: Queue a session payload carrying local-only and stray fields.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    const session = buildChargingSession({ id: 'session-allowlist', pricing_context: 'roaming' })

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'UPDATE',
      payload: {
        ...session,
        unexpected_remote_flag: true as unknown,
      } as unknown as ChargingSession,
      timestamp: new Date()
    })

    // Act: Process the outbox item.
    await processOutbox()

    // Assert: Uploads rebuild sessions from the writable column contract.
    expect(mockUpsert).toHaveBeenCalledWith({
      id: session.id,
      user_id: session.user_id,
      session_timestamp: session.session_timestamp,
      provider_id: session.provider_id,
      provider_name_snapshot: session.provider_name_snapshot,
      tariff_plan_id: session.tariff_plan_id,
      charging_plan_name_snapshot: session.charging_plan_name_snapshot,
      charging_type: session.charging_type,
      kwh_billed: session.kwh_billed,
      kwh_added: session.kwh_added,
      total_cost: session.total_cost,
      session_mode: session.session_mode,
      plan_selection_id: session.plan_selection_id,
      price_snapshot: session.price_snapshot,
      ad_hoc_pricing: session.ad_hoc_pricing,
      odometer_km: session.odometer_km,
      start_soc_percentage: session.start_soc_percentage,
      end_soc_percentage: session.end_soc_percentage,
      notes: session.notes,
      applied_price_per_kwh: session.applied_price_per_kwh,
      applied_ac_price_per_kwh: session.applied_ac_price_per_kwh,
      applied_dc_price_per_kwh: session.applied_dc_price_per_kwh,
      applied_roaming_ac_price_per_kwh: session.applied_roaming_ac_price_per_kwh,
      applied_roaming_dc_price_per_kwh: session.applied_roaming_dc_price_per_kwh,
      applied_monthly_base_fee: session.applied_monthly_base_fee,
      applied_session_fee: session.applied_session_fee,
      created_at: session.created_at,
      updated_at: session.updated_at,
      deleted_at: session.deleted_at,
    })
  })

  it('uploads explicit provider identities for plan and ad-hoc sessions', async () => {
    // Arrange: Queue one linked plan session and one unlinked ad-hoc session.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'plan-provider-upload', provider_id: 'provider-plan' }),
        timestamp: new Date('2026-05-21T12:00:00.000Z'),
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildAdHocChargingSession({ id: 'ad-hoc-provider-upload' }),
        timestamp: new Date('2026-05-21T12:01:00.000Z'),
      },
    ])

    // Act: Upload both canonical session variants.
    await processOutbox()

    // Assert: Plan linkage is preserved and ad-hoc identity remains snapshot-only.
    expect(mockUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'plan-provider-upload',
      provider_id: 'provider-plan',
    }))
    expect(mockUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'ad-hoc-provider-upload',
      provider_id: null,
      provider_name_snapshot: 'Cariqa',
    }))
  })

  it('should treat check-constraint violations as non-retryable validation failures', async () => {
    // Arrange: Return a Supabase check violation for a session payload.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const mockUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23514', message: 'new row for relation "charging_sessions" violates check constraint' }
    }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 'check-fail' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })

    // Act
    await processOutbox({ now: () => now })

    // Assert: item remains queued with no next retry and actionable error text.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.retry_count).toBe(1)
    expect(outboxItem.last_attempt_at).toEqual(now)
    expect(outboxItem.next_attempt_at).toBeUndefined()
    expect(outboxItem.last_error).toContain('Validation failed for sessions:')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Non-retryable sync validation error for table sessions:',
      'new row for relation "charging_sessions" violates check constraint'
    )
  })

  it('should treat charging-plan exclusion violations as non-retryable overlap conflicts', async () => {
    // Arrange: Return a Supabase exclusion violation for charging plans.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const mockUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_active_versions"' }
    }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: buildChargingPlan({ id: 'overlap-conflict' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })

    // Act
    await processOutbox({ now: () => now })

    // Assert: item remains queued without retry scheduling and with domain error text.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.retry_count).toBe(1)
    expect(outboxItem.last_attempt_at).toEqual(now)
    expect(outboxItem.next_attempt_at).toBeUndefined()
    expect(outboxItem.last_error).toBe('Tariff validity overlaps with an existing active version for this provider and name')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Non-retryable sync validation error for table charging_plans:',
      'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_active_versions"'
    )
  })

  it('does not replay blocked charging-plan overlap entries on later outbox passes', async () => {
    // Arrange: Queue one overlap conflict that Supabase rejects as non-retryable.
    const firstAttempt = new Date('2026-05-21T12:00:00.000Z')
    const secondAttempt = new Date('2026-05-21T12:01:00.000Z')
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_active_versions"' },
    }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>)
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: buildChargingPlan({ id: 'blocked-overlap-plan' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })

    // Act: Process the original conflict, then run a later outbox pass without a repair.
    await processOutbox({ now: () => firstAttempt })
    await processOutbox({ now: () => secondAttempt })

    // Assert: The blocked row remains diagnostic state and is not retried indefinitely.
    expect(chargingPlanUpsert).toHaveBeenCalledTimes(1)
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.retry_count).toBe(1)
    expect(outboxItem.last_attempt_at).toEqual(firstAttempt)
    expect(outboxItem.next_attempt_at).toBeUndefined()
  })

  it('clears an older blocked charging-plan entry after a newer same-row repair succeeds', async () => {
    // Arrange: Make the first version overlap remotely and accept its newer repair.
    const firstAttempt = new Date('2026-05-21T12:00:00.000Z')
    const repairAttempt = new Date('2026-05-21T12:02:00.000Z')
    const chargingPlanUpsert = vi.fn((plan: ChargingPlan) => Promise.resolve(
      plan.ac_price_per_kwh === 49
        ? { error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_active_versions"' } }
        : { error: null },
    ))
    vi.mocked(supabase.from).mockReturnValue({ upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>)
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: buildChargingPlan({ id: 'repairable-overlap-plan', ac_price_per_kwh: 49 }),
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
    })
    await processOutbox({ now: () => firstAttempt })
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'UPDATE',
      payload: buildChargingPlan({ id: 'repairable-overlap-plan', ac_price_per_kwh: 55 }),
      timestamp: new Date('2026-05-21T11:01:00.000Z'),
    })

    // Act: Process the repair in a later pass.
    await processOutbox({ now: () => repairAttempt })

    // Assert: The repair uploads once and supersedes the older blocked payload without replaying it.
    expect(chargingPlanUpsert).toHaveBeenCalledTimes(2)
    expect(chargingPlanUpsert.mock.calls.map(([plan]) => [plan.id, plan.ac_price_per_kwh])).toEqual([
      ['repairable-overlap-plan', 49],
      ['repairable-overlap-plan', 55],
    ])
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('should treat provider-level paid-tariff exclusion violations as non-retryable overlap conflicts', async () => {
    // Arrange: Return the provider-level paid-tariff exclusion violation from Supabase.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const mockUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_paid_provider_versions"' }
    }))
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>)

    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: buildChargingPlan({ id: 'paid-provider-overlap-conflict' }),
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    })

    // Act: Process the provider-level overlap failure.
    await processOutbox({ now: () => now })

    // Assert: The item stays queued without a retry schedule and names the actionable domain conflict.
    const [outboxItem] = await db.sync_outbox.toArray()
    expect(outboxItem.retry_count).toBe(1)
    expect(outboxItem.last_attempt_at).toEqual(now)
    expect(outboxItem.next_attempt_at).toBeUndefined()
    expect(outboxItem.last_error).toBe('Paid tariff validity overlaps with another active paid tariff for this provider')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Non-retryable sync validation error for table charging_plans:',
      'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_paid_provider_versions"'
    )
  })

  it('should continue processing later ready items after non-retryable charging-plan overlap failure', async () => {
    // Arrange: first item fails with non-retryable charging-plan overlap, second item is syncable.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_active_versions"' }
    }))
    const chargingSessionUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'charging_plans') return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
      if (tableName === 'charging_sessions') return { upsert: chargingSessionUpsert } as unknown as ReturnType<typeof supabase.from>
      return { upsert: vi.fn(() => Promise.resolve({ error: null })) } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({ id: 'blocked-overlap-plan' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'ready-session' }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      }
    ])

    // Act
    await processOutbox({ now: () => now })

    // Assert: failed charging plan remains with non-retryable metadata, later session still syncs.
    expect(chargingPlanUpsert).toHaveBeenCalledTimes(1)
    expect(chargingSessionUpsert).toHaveBeenCalledTimes(1)
    const outboxItems = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].table_name).toBe('charging_plans')
    expect(outboxItems[0].retry_count).toBe(1)
    expect(outboxItems[0].last_attempt_at).toEqual(now)
    expect(outboxItems[0].next_attempt_at).toBeUndefined()
    expect(outboxItems[0].last_error).toBe('Tariff validity overlaps with an existing active version for this provider and name')
  })

  it('should continue processing later ready items after provider-level paid-tariff overlap failure', async () => {
    // Arrange: The first item has a provider-level paid-tariff conflict and the later item is ready.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_paid_provider_versions"' }
    }))
    const chargingSessionUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'charging_plans') return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
      if (tableName === 'charging_sessions') return { upsert: chargingSessionUpsert } as unknown as ReturnType<typeof supabase.from>
      return { upsert: vi.fn(() => Promise.resolve({ error: null })) } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({ id: 'blocked-paid-provider-overlap-plan' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'ready-after-paid-provider-overlap' }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      }
    ])

    // Act: Process the outbox after the item-local provider-level overlap conflict.
    await processOutbox({ now: () => now })

    // Assert: The blocked plan remains queued while the later ready item is uploaded.
    expect(chargingPlanUpsert).toHaveBeenCalledTimes(1)
    expect(chargingSessionUpsert).toHaveBeenCalledTimes(1)
    const outboxItems = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].table_name).toBe('charging_plans')
    expect(outboxItems[0].retry_count).toBe(1)
    expect(outboxItems[0].last_attempt_at).toEqual(now)
    expect(outboxItems[0].next_attempt_at).toBeUndefined()
    expect(outboxItems[0].last_error).toBe('Paid tariff validity overlaps with another active paid tariff for this provider')
  })

  it('replays the June Lidl promo and SWM successor rows in deterministic timestamp order', async () => {
    // Arrange: Seed the same pre-June baselines locally and remotely.
    const remotePlans: ChargingPlan[] = [
      buildChargingPlan({
        id: 'lidl-baseline',
        provider_id: 'provider-lidl',
        name: 'Lidl',
        valid_from: utc('2026-01-01'),
        valid_to: null,
        ac_price_per_kwh: 49,
      }),
      buildChargingPlan({
        id: 'swm-baseline',
        provider_id: 'provider-swm',
        name: 'SWM',
        valid_from: utc('2026-01-01'),
        valid_to: null,
        ac_price_per_kwh: 59,
      }),
    ]

    await db.charging_plans.bulkAdd(remotePlans)

    await scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-lidl',
      name: 'Lidl',
      promoStart: utc('2026-06-01'),
      promoEndInclusive: utc('2026-06-30'),
      prices: buildPrices({ ac_price_per_kwh: 39 }),
    })
    await createSuccessorTariffVersion({
      userId: 'user-1',
      providerId: 'provider-swm',
      name: 'SWM',
      nextName: 'SWM',
      effectiveFrom: utc('2026-07-01'),
      prices: buildPrices({ ac_price_per_kwh: 65 }),
    })

    const queuedItems = await db.sync_outbox.orderBy('timestamp').toArray()
    const chargingPlanUpsert = vi.fn(async (payload: ChargingPlan) => {
      // Simulate Supabase's exclusion constraint against already-persisted rows.
      if (hasRemoteOverlap(payload, remotePlans)) {
        return {
          error: {
            code: '23P01',
            message: 'conflicting key value violates exclusion constraint "charging_plans_no_overlapping_active_versions"',
          },
        }
      }

      const index = remotePlans.findIndex((plan) => plan.id === payload.id)
      if (index >= 0) {
        remotePlans[index] = payload
      } else {
        remotePlans.push(payload)
      }

      return { error: null }
    })
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'charging_plans') {
        return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
      }

      return { upsert: vi.fn(() => Promise.resolve({ error: null })) } as unknown as ReturnType<typeof supabase.from>
    })

    // Act: Replay the queued tariff rows through the sync engine.
    await processOutbox()

    // Assert: One transaction can share a timestamp, but replay still preserves insertion order.
    expect(new Set(queuedItems.slice(0, 3).map((item) => item.timestamp.toISOString())).size).toBe(1)
    expect(new Set(queuedItems.slice(3).map((item) => item.timestamp.toISOString())).size).toBe(1)
    expect(
      queuedItems.map((item) => {
        const payload = item.payload as ChargingPlan
        return [
          item.action,
          payload.provider_id,
          payload.name,
          payload.valid_from.toISOString(),
          payload.valid_to?.toISOString() ?? null,
        ]
      })
    ).toEqual([
      ['UPDATE', 'provider-lidl', 'Lidl', '2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
      ['INSERT', 'provider-lidl', 'Lidl', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
      ['INSERT', 'provider-lidl', 'Lidl', '2026-07-01T00:00:00.000Z', null],
      ['UPDATE', 'provider-swm', 'SWM', '2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
      ['INSERT', 'provider-swm', 'SWM', '2026-07-01T00:00:00.000Z', null],
    ])
    expect(chargingPlanUpsert).toHaveBeenCalledTimes(5)
    expect(
      chargingPlanUpsert.mock.calls.map(([payload]) => [
        payload.id,
        payload.provider_id,
        payload.name,
        payload.valid_from.toISOString(),
        payload.valid_to?.toISOString() ?? null,
      ])
    ).toEqual(
      queuedItems.map((item) => {
        const payload = item.payload as ChargingPlan
        return [
          payload.id,
          payload.provider_id,
          payload.name,
          payload.valid_from.toISOString(),
          payload.valid_to?.toISOString() ?? null,
        ]
      })
    )
    expect(await db.sync_outbox.count()).toBe(0)
    expect(
      remotePlans
        .map((plan) => [
          plan.provider_id,
          plan.name,
          plan.valid_from.toISOString(),
          plan.valid_to?.toISOString() ?? null,
          plan.ac_price_per_kwh,
        ])
        .sort((left, right) => `${left[0]}:${left[2]}`.localeCompare(`${right[0]}:${right[2]}`))
    ).toEqual([
      ['provider-lidl', 'Lidl', '2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 49],
      ['provider-lidl', 'Lidl', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 39],
      ['provider-lidl', 'Lidl', '2026-07-01T00:00:00.000Z', null, 49],
      ['provider-swm', 'SWM', '2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 59],
      ['provider-swm', 'SWM', '2026-07-01T00:00:00.000Z', null, 65],
    ])
  })

  it('should stop processing after non-overlap non-retryable charging-plan failure', async () => {
    // Arrange: first charging-plan item fails non-retryable for a different validation reason.
    const now = new Date('2026-05-21T12:00:00.000Z')
    const chargingPlanUpsert = vi.fn(() => Promise.resolve({
      error: { code: '23514', message: 'new row for relation "charging_plans" violates check constraint "charging_plans_name_not_empty"' }
    }))
    const chargingSessionUpsert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(supabase.from).mockImplementation((tableName: string) => {
      if (tableName === 'charging_plans') return { upsert: chargingPlanUpsert } as unknown as ReturnType<typeof supabase.from>
      if (tableName === 'charging_sessions') return { upsert: chargingSessionUpsert } as unknown as ReturnType<typeof supabase.from>
      return { upsert: vi.fn(() => Promise.resolve({ error: null })) } as unknown as ReturnType<typeof supabase.from>
    })

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'charging_plans',
        action: 'INSERT',
        payload: buildChargingPlan({ id: 'blocked-non-overlap-plan' }),
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'should-not-sync' }),
        timestamp: new Date('2026-05-21T11:01:00.000Z')
      }
    ])

    // Act
    await processOutbox({ now: () => now })

    // Assert: queue does not continue for non-overlap charging-plan validation failure.
    expect(chargingPlanUpsert).toHaveBeenCalledTimes(1)
    expect(chargingSessionUpsert).not.toHaveBeenCalled()
    const outboxItems = await db.sync_outbox.orderBy('timestamp').toArray()
    expect(outboxItems).toHaveLength(2)
    expect(outboxItems[0].table_name).toBe('charging_plans')
    expect(outboxItems[0].retry_count).toBe(1)
    expect(outboxItems[0].last_attempt_at).toEqual(now)
    expect(outboxItems[0].next_attempt_at).toBeUndefined()
    expect(outboxItems[0].last_error).toContain('Validation failed for charging_plans:')
  })

  it('should pull data from Supabase into Dexie during initialSync', async () => {
    // Arrange: Return provider rows from the mocked Supabase select call.
    const mockProviders = [
      buildProvider({ id: 'p1', name: 'Ionity', user_id: 'u1' }),
      buildProvider({ id: 'p2', name: 'Elli', user_id: 'u1' })
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

  it('does not repopulate local user tables when hydration resolves after logout cleanup', async () => {
    // Arrange: Seed every local user table and defer the first hydration response.
    const existingProvider = buildProvider({ id: 'existing-provider' })
    const existingPlan = buildChargingPlan({ id: 'existing-plan' })
    const existingSelection = buildProviderPlanSelection({ id: 'existing-selection' })
    const existingSession = buildChargingSession({ id: 'existing-session' })
    await db.providers.add(existingProvider)
    await db.charging_plans.add(existingPlan)
    await db.provider_plan_selections.add(existingSelection)
    await db.sessions.add(existingSession)
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: existingSession,
      timestamp: new Date('2026-05-21T10:00:00.000Z')
    })
    let resolveProviderHydration: ((result: { data: Provider[]; error: null }) => void) | undefined
    const providerHydration = new Promise<{ data: Provider[]; error: null }>((resolve) => {
      resolveProviderHydration = resolve
    })
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => tableName === 'providers'
        ? providerHydration
        : Promise.resolve({ data: [], error: null })
    }) as unknown as ReturnType<typeof supabase.from>)
    const abortController = new AbortController()

    // Act: Begin hydration, abort it, purge logout data, then release the response.
    const hydrationPromise = initialSync({ signal: abortController.signal })
    await vi.waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('providers')
    })
    abortController.abort()
    await clearLocalUserData()
    resolveProviderHydration?.({
      data: [buildProvider({ id: 'delayed-provider', user_id: 'former-user' })],
      error: null
    })
    await hydrationPromise

    // Assert: The delayed response cannot recreate any former-user local data.
    expect(await db.providers.count()).toBe(0)
    expect(await db.charging_plans.count()).toBe(0)
    expect(await db.provider_plan_selections.count()).toBe(0)
    expect(await db.sessions.count()).toBe(0)
    expect(await db.sync_outbox.count()).toBe(0)
    expect(supabase.from).not.toHaveBeenCalledWith('charging_plans')
    expect(supabase.from).not.toHaveBeenCalledWith('charging_sessions')
  })

  it('should hydrate providers, charging plans, and sessions from their remote tables', async () => {
    // Arrange: Return table-specific rows from Supabase.
    const remoteProviders: Provider[] = [buildProvider({ id: 'p1', name: 'Ionity', user_id: 'u1' })]
    const remoteChargingPlans: ChargingPlan[] = [
      buildChargingPlan({ id: 'cp1', provider_id: 'p1', name: 'Ionity Passport', user_id: 'u1' })
    ]
    const remoteSessions: ChargingSession[] = [
      buildChargingSession({ id: 's1', provider_id: 'p1', tariff_plan_id: 'cp1', user_id: 'u1', total_cost: 1500 })
    ]

    const mockSelect = vi.fn((tableName: string) => {
      if (tableName === 'providers') return Promise.resolve({ data: remoteProviders, error: null })
      if (tableName === 'charging_plans') return Promise.resolve({ data: remoteChargingPlans, error: null })
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
    expect(supabase.from).toHaveBeenCalledWith('charging_plans')
    expect(supabase.from).toHaveBeenCalledWith('charging_sessions')
    expect(await db.providers.toArray()).toEqual(remoteProviders)
    expect(await db.charging_plans.toArray()).toEqual(remoteChargingPlans)
    expect(await db.sessions.toArray()).toEqual(remoteSessions)
  })

  it('requests explicit charging plan columns during initialSync hydration', async () => {
    // Arrange: Capture which select clause each Supabase table receives.
    const selectCalls: Array<{ tableName: string; columns: string }> = []

    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: (columns: string) => {
        selectCalls.push({ tableName, columns })
        return Promise.resolve({ data: [], error: null })
      }
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate local data from Supabase.
    await initialSync()

    // Assert: charging_plans uses a local-domain column allowlist instead of select('*').
    expect(selectCalls).toContainEqual({
      tableName: 'providers',
      columns: [
        'id',
        'user_id',
        'name',
        'created_at',
        'updated_at',
        'deleted_at',
      ].join(', ')
    })
    expect(selectCalls).toContainEqual({
      tableName: 'charging_plans',
      columns: [
        'id',
        'user_id',
        'provider_id',
        'name',
        'valid_from',
        'valid_to',
        'ac_price_per_kwh',
        'dc_price_per_kwh',
        'roaming_ac_price_per_kwh',
        'roaming_dc_price_per_kwh',
        'monthly_base_fee',
        'session_fee',
        'affiliation',
        'notes',
        'created_at',
        'updated_at',
        'deleted_at',
      ].join(', ')
    })
    expect(selectCalls).not.toContainEqual({
      tableName: 'charging_plans',
      columns: '*'
    })
    expect(selectCalls).toContainEqual({
      tableName: 'charging_sessions',
      columns: [
        'id',
        'user_id',
        'session_timestamp',
        'provider_id',
        'provider_name_snapshot',
        'charging_plan_name_snapshot',
        'charging_type',
        'kwh_billed',
        'kwh_added',
        'total_cost',
        'session_mode',
        'tariff_plan_id',
        'ad_hoc_pricing',
        'plan_selection_id',
        'price_snapshot',
        'odometer_km',
        'start_soc_percentage',
        'end_soc_percentage',
        'notes',
        'applied_price_per_kwh',
        'applied_ac_price_per_kwh',
        'applied_dc_price_per_kwh',
        'applied_roaming_ac_price_per_kwh',
        'applied_roaming_dc_price_per_kwh',
        'applied_monthly_base_fee',
        'applied_session_fee',
        'created_at',
        'updated_at',
        'deleted_at',
      ].join(', ')
    })
  })

  it('should omit generated charging plan columns during initialSync hydration', async () => {
    // Arrange: Supabase select('*') returns generated columns that clients cannot write back.
    const remoteChargingPlan = {
      ...buildChargingPlan({ id: 'cp-generated', user_id: 'u1' }),
      valid_period: '[2026-05-21,infinity)',
    }

    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => Promise.resolve({
        data: tableName === 'charging_plans' ? [remoteChargingPlan] : [],
        error: null,
      })
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate remote rows into Dexie.
    await initialSync()

    // Assert: Local charging plans keep only writable domain fields.
    const localChargingPlan = await db.charging_plans.get('cp-generated')
    expect(localChargingPlan).not.toHaveProperty('valid_period')
  })

  it('should normalize remote charging session timestamps before storing them locally', async () => {
    // Arrange: Supabase returns JSON timestamps as ISO strings.
    const remoteSession = {
      ...buildChargingSession({ id: 's-date-normalization', user_id: 'u1' }),
      session_timestamp: '2026-06-03T08:15:00.000Z',
      created_at: '2026-06-03T08:20:00.000Z',
      updated_at: '2026-06-03T08:20:00.000Z',
    }

    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => Promise.resolve({
        data: tableName === 'charging_sessions' ? [remoteSession] : [],
        error: null,
      })
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate the remote session into Dexie.
    await initialSync()

    // Assert: Local domain timestamps satisfy the Date-based session contract.
    const localSession = await db.sessions.get('s-date-normalization')
    expect(localSession?.session_timestamp).toBeInstanceOf(Date)
    expect(localSession?.created_at).toBeInstanceOf(Date)
    expect(localSession?.updated_at).toBeInstanceOf(Date)
    expect(localSession?.session_timestamp.toISOString()).toBe('2026-06-03T08:15:00.000Z')
  })

  it('hydrates an ad-hoc billing provider and CPO without creating a provider link', async () => {
    // Arrange: Supabase returns the billing-provider and operator snapshots.
    const remoteSession = {
      ...buildAdHocChargingSession({ id: 'ad-hoc-hydration' }),
      session_timestamp: '2026-06-03T08:15:00.000Z',
      created_at: '2026-06-03T08:20:00.000Z',
      updated_at: '2026-06-03T08:20:00.000Z',
    }
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => Promise.resolve({
        data: tableName === 'charging_sessions' ? [remoteSession] : [],
        error: null,
      })
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate the remote session into Dexie.
    await initialSync()

    // Assert: The role snapshots round-trip while provider linkage remains absent.
    const localSession = await db.sessions.get('ad-hoc-hydration')
    expect(localSession).toMatchObject({
      session_mode: 'ad_hoc',
      provider_id: null,
      provider_name_snapshot: 'Cariqa',
      ad_hoc_pricing: { cpoName: 'TEAG', pricePerKwh: 59 },
    })
  })

  it.each([
    ['plan session without a provider', { ...buildChargingSession(), provider_id: null }, 'Plan charging session requires a provider id'],
    ['ad-hoc session with a provider link', { ...buildAdHocChargingSession(), provider_id: 'provider-linked' }, 'Ad-hoc charging session cannot include a provider id'],
    ['ad-hoc session without a billing-provider snapshot', { ...buildAdHocChargingSession(), provider_name_snapshot: '   ' }, 'Invalid charging session base fields'],
    ['ad-hoc session with a blank CPO snapshot', {
      ...buildAdHocChargingSession(),
      ad_hoc_pricing: { cpoName: '   ', pricePerKwh: 59 },
    }, 'Ad-hoc charging session has an invalid CPO snapshot'],
    ['ad-hoc session with a non-string CPO snapshot', {
      ...buildAdHocChargingSession(),
      ad_hoc_pricing: { cpoName: 42, pricePerKwh: 59 },
    }, 'Ad-hoc charging session has an invalid CPO snapshot'],
    ['ad-hoc session with an invalid session fee', {
      ...buildAdHocChargingSession(),
      ad_hoc_pricing: { cpoName: 'TEAG', pricePerKwh: 59, pricePerSession: '199' },
    }, 'Ad-hoc charging session has an invalid session-fee snapshot'],
    ['ad-hoc session with malformed other fees', {
      ...buildAdHocChargingSession(),
      ad_hoc_pricing: { cpoName: 'TEAG', pricePerKwh: 59, otherFees: { amount: 50 } },
    }, 'Ad-hoc charging session has invalid other-fee snapshots'],
    ['ad-hoc session with an invalid other-fee amount', {
      ...buildAdHocChargingSession(),
      ad_hoc_pricing: {
        cpoName: 'TEAG',
        pricePerKwh: 59,
        otherFees: [{ label: 'Parking', amount: 12.5 }],
      },
    }, 'Ad-hoc charging session has invalid other-fee snapshots'],
    ['ad-hoc session with a non-string receipt URL', {
      ...buildAdHocChargingSession(),
      ad_hoc_pricing: { cpoName: 'TEAG', pricePerKwh: 59, receiptUrl: 42 },
    }, 'Ad-hoc charging session has an invalid receipt URL snapshot'],
  ])('rejects %s before writing the session batch', async (_description, invalidSession, errorMessage) => {
    // Arrange: Keep an existing row that an invalid remote batch must not replace.
    const existingSession = buildChargingSession({ id: 'existing-session' })
    await db.sessions.add(existingSession)
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => Promise.resolve({
        data: tableName === 'charging_sessions'
          ? [buildChargingSession({ id: 'otherwise-valid-session' }), invalidSession]
          : [],
        error: null,
      })
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Attempt to hydrate a session batch containing an invalid row.
    await initialSync()

    // Assert: Validation is atomic for the session table.
    expect(await db.sessions.toArray()).toEqual([existingSession])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error hydrating data for sessions:',
      errorMessage
    )
  })

  it('isolates invalid session hydration from providers and charging plans', async () => {
    // Arrange: Return valid earlier tables and an invalid session provider combination.
    const provider = buildProvider({ id: 'hydrated-provider' })
    const plan = buildChargingPlan({ id: 'hydrated-plan', provider_id: provider.id })
    const existingSession = buildChargingSession({ id: 'preserved-session' })
    await db.sessions.add(existingSession)
    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => Promise.resolve({
        data: tableName === 'providers'
          ? [provider]
          : tableName === 'charging_plans'
            ? [plan]
            : [{ ...buildAdHocChargingSession(), provider_id: provider.id }],
        error: null,
      })
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate all remote tables.
    const result = await initialSync()

    // Assert: Only the invalid sessions table is rejected.
    expect(await db.providers.toArray()).toEqual([provider])
    expect(await db.charging_plans.toArray()).toEqual([plan])
    expect(await db.sessions.toArray()).toEqual([existingSession])
    expect(result).toEqual({
      providers: { status: 'ready' },
      charging_plans: { status: 'ready' },
      sessions: { status: 'failed', failureKind: 'invalid_data' },
    })
  })

  it('should continue initialSync when one remote table fails', async () => {
    // Arrange: Make providers fail while charging_plans and sessions still return data.
    const remoteChargingPlans: ChargingPlan[] = [
      buildChargingPlan({ id: 'cp1', provider_id: 'p1', name: 'Fallback plan', user_id: 'u1' })
    ]
    const remoteSessions: ChargingSession[] = [
      buildChargingSession({ id: 's1', provider_id: 'p1', tariff_plan_id: 'cp1', user_id: 'u1', total_cost: 1500 })
    ]

    vi.mocked(supabase.from).mockImplementation((tableName: string) => ({
      select: () => {
        if (tableName === 'providers') return Promise.resolve({ data: null, error: { message: 'Provider pull failed' } })
        if (tableName === 'charging_plans') return Promise.resolve({ data: remoteChargingPlans, error: null })
        if (tableName === 'charging_sessions') return Promise.resolve({ data: remoteSessions, error: null })
        return Promise.resolve({ data: [], error: null })
      }
    }) as unknown as ReturnType<typeof supabase.from>)

    // Act: Hydrate local data from Supabase.
    const result = await initialSync()

    // Assert: A single table error does not block remaining local hydration.
    expect(await db.providers.count()).toBe(0)
    expect(await db.charging_plans.toArray()).toEqual(remoteChargingPlans)
    expect(await db.sessions.toArray()).toEqual(remoteSessions)
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error pulling data for providers:', 'Provider pull failed')
    expect(result).toEqual({
      providers: { status: 'failed', failureKind: 'network' },
      charging_plans: { status: 'ready' },
      sessions: { status: 'ready' },
    })
  })

  it('should keep pending outbox items during initialSync', async () => {
    // Arrange: Queue a local write and return no remote rows.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 'pending-local' }),
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
    expect(pendingItems[0].payload.id).toBe('pending-local')
  })
})
