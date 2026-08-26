import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, type ChargingPlan, type Provider, type SyncOutbox } from '../../../infra/db';
import { prepareProviderConflictRecovery } from './providerConflictRecoveryService';

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}));

vi.mock('../../../infra/supabase', () => ({ supabase: supabaseMock }));

const terminalConflictMessage = 'Provider name already exists remotely (active, case-insensitive)';
type TerminalOutboxWithFailureKind = SyncOutbox & {
  failure_kind?: 'provider-name-conflict';
};

const createRemoteQuery = (data: unknown, error: unknown = null) => {
  const result = Promise.resolve({ data, error });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    in: vi.fn(() => query),
    then: result.then.bind(result),
  };
  return query;
};

const buildStagedProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'staged-provider',
  user_id: 'user-1',
  name: 'Ionity',
  created_at: new Date('2026-08-25T10:00:00.000Z'),
  updated_at: new Date('2026-08-25T10:00:00.000Z'),
  ...overrides,
});

const buildChargingPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: 'canonical-plan',
  user_id: 'user-1',
  provider_id: 'canonical-provider',
  name: 'Canonical plan',
  valid_from: new Date('2026-08-25T00:00:00.000Z'),
  valid_to: null,
  monthly_base_fee: 0,
  session_fee: 0,
  created_at: new Date('2026-08-25T10:00:00.000Z'),
  updated_at: new Date('2026-08-25T10:00:00.000Z'),
  ...overrides,
});

const buildTerminalOutbox = (
  overrides: Partial<TerminalOutboxWithFailureKind> = {},
): TerminalOutboxWithFailureKind => ({
  table_name: 'providers',
  action: 'INSERT',
  payload: buildStagedProvider(),
  timestamp: new Date('2026-08-25T10:01:00.000Z'),
  retry_count: 1,
  last_attempt_at: new Date('2026-08-25T10:01:01.000Z'),
  next_attempt_at: undefined,
  last_error: terminalConflictMessage,
  failure_kind: 'provider-name-conflict',
  ...overrides,
});

/**
 * RED contract tests for read-only provider-conflict recovery preparation.
 *
 * These fixtures define eligibility, ownership, graph, remote-preflight, and
 * review-token safety before Task 6 introduces any implementation behavior.
 */
describe('prepareProviderConflictRecovery', () => {
  beforeEach(async () => {
    await db.providers.clear();
    await db.charging_plans.clear();
    await db.provider_plan_selections.clear();
    await db.sessions.clear();
    await db.sync_outbox.clear();
    await db.provider_reconciliations.clear();
    vi.clearAllMocks();
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers'
        ? [buildStagedProvider({ id: 'canonical-provider' })]
        : [],
    ));
  });

  it('returns a ready descriptor only for the authenticated staged-provider terminal conflict', async () => {
    // Arrange: the local graph contains exactly the recoverable provider insert.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());

    // Act and Assert: preparation returns an opaque descriptor instead of mutating local state.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({
        status: 'ready',
        descriptor: {
          userId: 'user-1',
          terminalOutboxId,
          stagedProviderId: stagedProvider.id,
          canonicalProviderId: expect.any(String),
          reviewVersion: expect.any(String),
        },
      });
    expect(await db.sync_outbox.get(terminalOutboxId)).toMatchObject(buildTerminalOutbox());
    expect(await db.providers.get(stagedProvider.id)).toEqual(stagedProvider);
  });

  it('recognizes the durable failure kind even when the safe display message changes', async () => {
    // Arrange: display copy is not a durable recovery discriminator.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox({
      last_error: 'This copy may change without changing recovery eligibility.',
    }));

    // Act and Assert: the typed terminal state, not persisted display text, permits preparation.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'ready' });
  });

  it('fails closed for a legacy unmarked terminal row even when its old display message matches', async () => {
    // Arrange: old rows have no typed classification and must not be backfilled from copy.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox({
      failure_kind: undefined,
      last_error: terminalConflictMessage,
    }));

    // Act and Assert: recovery remains unavailable until separately approved legacy handling exists.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
  });

  it.each([
    ['a non-provider row', { table_name: 'charging_plans' as const }],
    ['a non-insert provider action', { action: 'UPDATE' as const }],
    ['a retryable conflict', { next_attempt_at: new Date('2026-08-25T10:02:00.000Z') }],
    ['an unrecognized terminal error', {
      last_error: 'Unable to sync provider. Please try again.',
      failure_kind: undefined,
    }],
    ['a payload owned by another user', { payload: buildStagedProvider({ user_id: 'user-2' }) }],
  ])('blocks %s without changing the terminal outbox row', async (_label, overrides) => {
    // Arrange: every near miss must remain a generic non-recovery path.
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox(overrides));
    const before = await db.sync_outbox.get(terminalOutboxId);

    // Act and Assert: eligibility failures are safe and side-effect free.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(await db.sync_outbox.get(terminalOutboxId)).toEqual(before);
  });

  it('blocks absent, foreign, or changed authenticated users before remote preflight', async () => {
    // Arrange: a valid local conflict is not enough without one stable authenticated owner.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());

    // Act and Assert: no caller identity may inspect another user’s conflict.
    await expect(prepareProviderConflictRecovery({ userId: '', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    await expect(prepareProviderConflictRecovery({ userId: 'user-2', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
  });

  it('blocks a malformed graph rather than inferring provider relationships from ad-hoc text', async () => {
    // Arrange: an ad-hoc session with matching display text must not be treated as affected.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    await db.sessions.add({
      id: 'ad-hoc-session',
      user_id: 'user-1',
      session_timestamp: new Date('2026-08-25T10:00:00.000Z'),
      provider_id: null,
      provider_name_snapshot: stagedProvider.name,
      charging_plan_name_snapshot: 'Ad-Hoc',
      charging_type: 'AC',
      kwh_billed: 10,
      total_cost: 500,
      session_mode: 'ad_hoc',
      pricing_context: 'ad_hoc',
      tariff_plan_id: null,
      plan_selection_id: null,
      ad_hoc_pricing: { pricePerKwh: 50 },
      applied_session_fee: 0,
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    });

    // Act and Assert: preparation must inspect only relational provider IDs.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'ready' });
    expect((await db.sessions.get('ad-hoc-session'))?.provider_id).toBeNull();
  });

  it.each([
    ['zero', []],
    ['multiple', [
      buildStagedProvider({ id: 'canonical-provider-a' }),
      buildStagedProvider({ id: 'canonical-provider-b' }),
    ]],
  ])('blocks %s active normalized-name canonical matches', async (_label, providerRows) => {
    // Arrange: RLS-visible data must contain exactly one canonical provider, never zero or many.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers' ? providerRows : [],
    ));

    // Act and Assert: ambiguity is blocked without local mutation.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(await db.providers.get(stagedProvider.id)).toEqual(stagedProvider);
  });

  it('blocks provider names rejected by the canonical validation helper', async () => {
    // Arrange: corrupted local and remote names must not become a recovery target.
    const stagedProvider = buildStagedProvider({ name: 'Ionity\u0000' });
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox({ payload: stagedProvider }));
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers' ? [buildStagedProvider({ id: 'canonical-provider', name: stagedProvider.name })] : [],
    ));

    // Act and Assert: provider-name normalization never accepts invalid names.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
  });

  it('blocks unexplained canonical-provider local state that is absent from remote preflight', async () => {
    // Arrange: a locally queued canonical plan cannot be silently omitted from the review graph.
    const stagedProvider = buildStagedProvider();
    const canonicalProvider = buildStagedProvider({ id: 'canonical-provider' });
    await db.providers.bulkAdd([stagedProvider, canonicalProvider]);
    await db.charging_plans.add(buildChargingPlan());
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());

    // Act and Assert: unexplained canonical divergence prevents a misleading ready descriptor.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(await db.charging_plans.get('canonical-plan')).toMatchObject(buildChargingPlan());
  });

  it('de-duplicates an equivalent canonical local plan during remote preflight', async () => {
    // Arrange: a hydrated canonical row matching the remote record is not unexplained divergence.
    const stagedProvider = buildStagedProvider();
    const canonicalProvider = buildStagedProvider({ id: 'canonical-provider' });
    const canonicalPlan = buildChargingPlan();
    await db.providers.bulkAdd([stagedProvider, canonicalProvider]);
    await db.charging_plans.add(canonicalPlan);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers' ? [canonicalProvider] : [canonicalPlan],
    ));

    // Act and Assert: stable-ID-equivalent state remains eligible for review.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'ready' });
  });

  it('fails closed when the authenticated principal changes during remote preflight', async () => {
    // Arrange: the authenticated user changes after preparation begins.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'user-2' } }, error: null });

    // Act and Assert: a switched session cannot inspect or prepare recovery.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(await db.sync_outbox.get(terminalOutboxId)).toMatchObject(buildTerminalOutbox());
  });

  it('does not start the canonical-plan read after the authenticated user changes', async () => {
    // Arrange: the session changes after the provider lookup, before plan preflight.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'user-2' } }, error: null });

    // Act and Assert: no second remote read occurs with a changed principal.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('blocks foreign or malformed remote canonical rows and treats remote transport failure as retryable', async () => {
    // Arrange: remote RLS output is independently shape- and owner-checked.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers'
        ? [{ ...buildStagedProvider({ id: 'canonical-provider' }), user_id: 'user-2' }]
        : [],
    ));

    // Act and Assert: a foreign canonical row is an integrity block.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });

    // Arrange: an operational failure remains retryable rather than being treated as no match.
    supabaseMock.from.mockReturnValue(createRemoteQuery(null, { message: 'offline' }));

    // Act and Assert: transient remote failure writes nothing locally.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'retryable-error' });
    expect(await db.sync_outbox.get(terminalOutboxId)).toMatchObject(buildTerminalOutbox());
  });
});
