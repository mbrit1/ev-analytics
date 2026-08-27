import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  db,
  type ChargingPlan,
  type ChargingSession,
  type Provider,
  type ProviderPlanSelection,
  type SyncOutbox,
} from '../../../infra/db';
import type { ProviderConflictRecoveryDescriptor } from '../model/providerConflictRecovery';
import * as providerConflictRecoveryService from './providerConflictRecoveryService';

const { prepareProviderConflictRecovery } = providerConflictRecoveryService;

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
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => callback({}),
      },
    });
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

  it('blocks an incompatible remotely persisted selection before rebinding its local graph', async () => {
    // Arrange: a partially synced selection with an invalid remote owner is an integrity conflict.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({
      id: 'partial-plan',
      provider_id: stagedProvider.id,
    });
    const selection: ProviderPlanSelection = {
      id: 'partial-selection',
      user_id: 'user-1',
      provider_id: stagedProvider.id,
      tariff_plan_id: stagedPlan.id,
      valid_from: new Date('2026-08-25T00:00:00.000Z'),
      valid_to: null,
      price_snapshot: { label: 'Ionity', kWhPrice: 79 },
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    };
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    await db.provider_plan_selections.add(selection);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers'
        ? [buildStagedProvider({ id: 'canonical-provider' })]
        : table === 'provider_plan_selections'
          ? [{ ...selection, user_id: 'user-2', provider_id: 'canonical-provider' }]
          : [],
    ));

    // Act and Assert: remote partial success must be owner-validated before local rewrites.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(await db.provider_plan_selections.get(selection.id)).toEqual(selection);
  });

  it('accepts a compatible remotely persisted selection as partial prior success', async () => {
    // Arrange: the remote selection already has the canonical provider but otherwise matches the staged row.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({
      id: 'compatible-partial-plan',
      provider_id: stagedProvider.id,
    });
    const selection: ProviderPlanSelection = {
      id: 'compatible-partial-selection',
      user_id: 'user-1',
      provider_id: stagedProvider.id,
      tariff_plan_id: stagedPlan.id,
      valid_from: new Date('2026-08-25T00:00:00.000Z'),
      valid_to: null,
      price_snapshot: { label: 'Ionity', kWhPrice: 79 },
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    };
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    await db.provider_plan_selections.add(selection);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers'
        ? [buildStagedProvider({ id: 'canonical-provider' })]
        : table === 'provider_plan_selections'
          ? [{ ...selection, provider_id: 'canonical-provider' }]
          : [],
    ));

    // Act and Assert: the compatible prior remote write is safe to include in the review.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'ready' });
  });

  it('blocks an incompatible remotely persisted plan-mode session before rebinding its local graph', async () => {
    // Arrange: a partially synced plan-mode session must be verified before its provider ID moves.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({
      id: 'partial-session-plan',
      provider_id: stagedProvider.id,
    });
    const session: Extract<ChargingSession, { session_mode: 'plan' }> = {
      id: 'partial-session',
      user_id: 'user-1',
      provider_id: stagedProvider.id,
      provider_name_snapshot: 'Ionity',
      tariff_plan_id: stagedPlan.id,
      plan_selection_id: null,
      charging_plan_name_snapshot: 'Ionity plan',
      session_timestamp: new Date('2026-08-25T10:00:00.000Z'),
      charging_type: 'DC',
      kwh_billed: 10,
      total_cost: 790,
      session_mode: 'plan',
      applied_session_fee: 0,
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    };
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    await db.sessions.add(session);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers'
        ? [buildStagedProvider({ id: 'canonical-provider' })]
        : table === 'charging_sessions'
          ? [{ ...session, user_id: 'user-2', provider_id: 'canonical-provider' }]
          : [],
    ));

    // Act and Assert: an owner mismatch in remote partial success blocks local mutation.
    await expect(prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId }))
      .resolves.toMatchObject({ status: 'blocked' });
    expect(await db.sessions.get(session.id)).toEqual(session);
  });

  it('accepts a compatible remotely persisted plan-mode session as partial prior success', async () => {
    // Arrange: the remote session already uses the canonical provider and otherwise matches local history.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({
      id: 'compatible-session-plan',
      provider_id: stagedProvider.id,
    });
    const session: Extract<ChargingSession, { session_mode: 'plan' }> = {
      id: 'compatible-session',
      user_id: 'user-1',
      provider_id: stagedProvider.id,
      provider_name_snapshot: 'Ionity',
      tariff_plan_id: stagedPlan.id,
      plan_selection_id: null,
      charging_plan_name_snapshot: 'Ionity plan',
      session_timestamp: new Date('2026-08-25T10:00:00.000Z'),
      charging_type: 'DC',
      kwh_billed: 10,
      total_cost: 790,
      session_mode: 'plan',
      applied_session_fee: 0,
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    };
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    await db.sessions.add(session);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    supabaseMock.from.mockImplementation((table: string) => createRemoteQuery(
      table === 'providers'
        ? [buildStagedProvider({ id: 'canonical-provider' })]
        : table === 'charging_sessions'
          ? [{ ...session, provider_id: 'canonical-provider' }]
          : [],
    ));

    // Act and Assert: a canonical remote prior write is included rather than treated as divergence.
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

/**
 * RED contract tests for all-or-nothing provider conflict confirmation.
 *
 * Confirmation is deliberately specified after read-only preparation so no
 * partial graph rewrite can become the accidental recovery contract.
 */
describe('confirmProviderConflictRecovery', () => {
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

  it('replaces the no-reference staged provider only with durable completion evidence', async () => {
    // Arrange: only a typed terminal insert and its staged provider require reconciliation.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;

    const confirm = (providerConflictRecoveryService as {
      confirmProviderConflictRecovery?: (descriptor: ProviderConflictRecoveryDescriptor) => Promise<unknown>;
    }).confirmProviderConflictRecovery;

    // Act and Assert: confirmation is an explicit, transactional service operation.
    expect(confirm).toBeTypeOf('function');
    if (!confirm) return;
    await confirm(preparation.descriptor);

    expect(await db.providers.get(stagedProvider.id)).toBeUndefined();
    expect(await db.providers.get('canonical-provider')).toMatchObject({
      id: 'canonical-provider',
      user_id: 'user-1',
    });
    expect(await db.sync_outbox.get(terminalOutboxId)).toBeUndefined();
    expect(await db.provider_reconciliations.get(terminalOutboxId)).toMatchObject({
      terminal_outbox_id: terminalOutboxId,
      user_id: 'user-1',
      staged_provider_id: stagedProvider.id,
      canonical_provider_id: 'canonical-provider',
    });
  });

  it('blocks confirmation when the authenticated user changes after the final remote preflight', async () => {
    // Arrange: a no-reference graph has no affected selection or session read to supply a final auth check.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const confirm = providerConflictRecoveryService.confirmProviderConflictRecovery;
    supabaseMock.auth.getUser.mockReset();
    for (let call = 0; call < 6; call += 1) {
      supabaseMock.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null });
    }
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null });

    // Act: the session changes after the last remote response but before the local write transaction.
    const result = await confirm(preparation.descriptor);

    // Assert: no write may be committed under an authenticated identity that was not rechecked.
    expect(result).toMatchObject({ status: 'blocked' });
    expect(await db.providers.get(stagedProvider.id)).toEqual(stagedProvider);
    expect(await db.sync_outbox.get(terminalOutboxId)).toMatchObject(buildTerminalOutbox());
    expect(await db.provider_reconciliations.get(terminalOutboxId)).toBeUndefined();
  });

  it('returns a safe retryable result and rolls back every write when evidence persistence fails', async () => {
    // Arrange: inject a late transaction-stage failure after all graph reads and rewrites are ready.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const before = await Promise.all([
      db.providers.toArray(),
      db.charging_plans.toArray(),
      db.provider_plan_selections.toArray(),
      db.sessions.toArray(),
      db.sync_outbox.toArray(),
      db.provider_reconciliations.toArray(),
    ]);
    vi.spyOn(db.provider_reconciliations, 'add').mockRejectedValueOnce(new Error('evidence write failed'));

    // Act: the final local evidence write fails inside the all-table transaction.
    const result = await providerConflictRecoveryService.confirmProviderConflictRecovery(
      preparation.descriptor,
    );

    // Assert: the caller receives no raw storage error and every table returns to its exact prior state.
    expect(result).toMatchObject({ status: 'retryable-error' });
    await expect(Promise.all([
      db.providers.toArray(),
      db.charging_plans.toArray(),
      db.provider_plan_selections.toArray(),
      db.sessions.toArray(),
      db.sync_outbox.toArray(),
      db.provider_reconciliations.toArray(),
    ])).resolves.toEqual(before);
  });

  it.each([
    ['canonical provider write', () => vi.spyOn(db.providers, 'put').mockRejectedValueOnce(new Error('provider write failed'))],
    ['charging-plan write', () => vi.spyOn(db.charging_plans, 'bulkPut').mockRejectedValueOnce(new Error('plan write failed'))],
    ['selection write', () => vi.spyOn(db.provider_plan_selections, 'bulkPut').mockRejectedValueOnce(new Error('selection write failed'))],
    ['session write', () => vi.spyOn(db.sessions, 'bulkPut').mockRejectedValueOnce(new Error('session write failed'))],
    ['terminal outbox delete', () => vi.spyOn(db.sync_outbox, 'delete').mockRejectedValueOnce(new Error('outbox delete failed'))],
    ['staged provider delete', () => vi.spyOn(db.providers, 'delete').mockRejectedValueOnce(new Error('provider delete failed'))],
  ])('rolls back every table when %s fails', async (_label, injectFailure) => {
    // Arrange: every transaction stage must be independently able to abort the same no-reference graph.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const before = await Promise.all([
      db.providers.toArray(),
      db.charging_plans.toArray(),
      db.provider_plan_selections.toArray(),
      db.sessions.toArray(),
      db.sync_outbox.toArray(),
      db.provider_reconciliations.toArray(),
    ]);
    injectFailure();

    // Act and Assert: any stage failure is user-safe and atomically leaves all stores unchanged.
    await expect(providerConflictRecoveryService.confirmProviderConflictRecovery(preparation.descriptor))
      .resolves.toMatchObject({ status: 'retryable-error' });
    await expect(Promise.all([
      db.providers.toArray(),
      db.charging_plans.toArray(),
      db.provider_plan_selections.toArray(),
      db.sessions.toArray(),
      db.sync_outbox.toArray(),
      db.provider_reconciliations.toArray(),
    ])).resolves.toEqual(before);
  });

  it('rolls back a tariff graph when rewriting its dependent outbox payload fails', async () => {
    // Arrange: a dependent plan row makes the per-item outbox rewrite an explicit transaction stage.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({ id: 'outbox-rewrite-plan', provider_id: stagedProvider.id });
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: stagedPlan,
      timestamp: new Date('2026-08-25T10:02:00.000Z'),
    });
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const before = await Promise.all([
      db.providers.toArray(),
      db.charging_plans.toArray(),
      db.provider_plan_selections.toArray(),
      db.sessions.toArray(),
      db.sync_outbox.toArray(),
      db.provider_reconciliations.toArray(),
    ]);
    vi.spyOn(db.sync_outbox, 'put').mockRejectedValueOnce(new Error('outbox rewrite failed'));

    // Act and Assert: no plan rebind or terminal deletion escapes the failed payload rewrite.
    await expect(providerConflictRecoveryService.confirmProviderConflictRecovery(preparation.descriptor))
      .resolves.toMatchObject({ status: 'retryable-error' });
    await expect(Promise.all([
      db.providers.toArray(),
      db.charging_plans.toArray(),
      db.provider_plan_selections.toArray(),
      db.sessions.toArray(),
      db.sync_outbox.toArray(),
      db.provider_reconciliations.toArray(),
    ])).resolves.toEqual(before);
  });

  it('rebinds a tariff-only graph and preserves its dependent outbox identity', async () => {
    // Arrange: the staged provider has one tariff and an unsynced tariff insert.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({
      id: 'staged-plan',
      provider_id: stagedProvider.id,
    });
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const planOutboxId = await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: stagedPlan,
      timestamp: new Date('2026-08-25T10:02:00.000Z'),
      retry_count: 2,
      last_attempt_at: new Date('2026-08-25T10:03:00.000Z'),
      next_attempt_at: new Date('2026-08-25T10:04:00.000Z'),
      last_error: 'Temporary network error',
    });
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const confirm = (providerConflictRecoveryService as {
      confirmProviderConflictRecovery?: (descriptor: ProviderConflictRecoveryDescriptor) => Promise<unknown>;
    }).confirmProviderConflictRecovery;
    expect(confirm).toBeTypeOf('function');
    if (!confirm) return;

    // Act: approve the reviewed provider substitution.
    await confirm(preparation.descriptor);

    // Assert: tariff identity is stable while its provider reference and payload are rebound.
    expect(await db.charging_plans.get(stagedPlan.id)).toMatchObject({
      ...stagedPlan,
      provider_id: 'canonical-provider',
    });
    expect(await db.sync_outbox.get(planOutboxId)).toMatchObject({
      id: planOutboxId,
      table_name: 'charging_plans',
      action: 'INSERT',
      timestamp: new Date('2026-08-25T10:02:00.000Z'),
      payload: expect.objectContaining({
        id: stagedPlan.id,
        provider_id: 'canonical-provider',
      }),
    });
    const rewrittenOutbox = await db.sync_outbox.get(planOutboxId);
    expect(rewrittenOutbox).not.toHaveProperty('retry_count');
    expect(rewrittenOutbox).not.toHaveProperty('last_attempt_at');
    expect(rewrittenOutbox).not.toHaveProperty('next_attempt_at');
    expect(rewrittenOutbox).not.toHaveProperty('last_error');
    expect(await db.providers.get(stagedProvider.id)).toBeUndefined();
    expect(await db.sync_outbox.get(terminalOutboxId)).toBeUndefined();
  });

  it('rebinds a soft-deleted tariff reference without reviving its deletion or queue intent', async () => {
    // Arrange: recovery must retain soft-delete history and the corresponding DELETE replay action.
    const stagedProvider = buildStagedProvider();
    const deletedAt = new Date('2026-08-25T10:02:00.000Z');
    const stagedPlan = buildChargingPlan({
      id: 'soft-deleted-plan',
      provider_id: stagedProvider.id,
      deleted_at: deletedAt,
    });
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const planOutboxId = await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'DELETE',
      payload: stagedPlan,
      timestamp: new Date('2026-08-25T10:03:00.000Z'),
    });
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;

    // Act: reconcile the reviewed soft-deleted graph.
    await expect(providerConflictRecoveryService.confirmProviderConflictRecovery(preparation.descriptor))
      .resolves.toMatchObject({ status: 'reconciled' });

    // Assert: only the provider linkage changes; deletion history and mutation intent remain stable.
    expect(await db.charging_plans.get(stagedPlan.id)).toEqual({
      ...stagedPlan,
      provider_id: 'canonical-provider',
    });
    expect(await db.sync_outbox.get(planOutboxId)).toMatchObject({
      id: planOutboxId,
      table_name: 'charging_plans',
      action: 'DELETE',
      timestamp: new Date('2026-08-25T10:03:00.000Z'),
      payload: { ...stagedPlan, provider_id: 'canonical-provider' },
    });
  });

  it('rejects completion evidence when current postconditions no longer prove reconciliation', async () => {
    // Arrange: complete a normal no-reference reconciliation, then corrupt its current postcondition.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const confirm = (providerConflictRecoveryService as {
      confirmProviderConflictRecovery?: (descriptor: ProviderConflictRecoveryDescriptor) => Promise<unknown>;
    }).confirmProviderConflictRecovery;
    expect(confirm).toBeTypeOf('function');
    if (!confirm) return;
    await confirm(preparation.descriptor);
    await db.providers.delete('canonical-provider');

    // Act: a repeated confirmation may use evidence only after exact state verification.
    const repeated = await confirm(preparation.descriptor);

    // Assert: missing canonical state is not silently reported as already reconciled.
    expect(repeated).toMatchObject({ status: 'blocked' });
  });

  it('rejects completion evidence when an affected outbox payload is no longer canonical', async () => {
    // Arrange: complete a tariff-only reconciliation with one retained dependent outbox row.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({ id: 'evidence-plan', provider_id: stagedProvider.id });
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const planOutboxId = await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'INSERT',
      payload: stagedPlan,
      timestamp: new Date('2026-08-25T10:02:00.000Z'),
    });
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const confirm = (providerConflictRecoveryService as {
      confirmProviderConflictRecovery?: (descriptor: ProviderConflictRecoveryDescriptor) => Promise<unknown>;
    }).confirmProviderConflictRecovery;
    expect(confirm).toBeTypeOf('function');
    if (!confirm) return;
    await confirm(preparation.descriptor);
    await db.sync_outbox.update(planOutboxId, {
      payload: { ...stagedPlan, provider_id: 'unexpected-provider' },
    });

    // Act and Assert: evidence cannot override a current payload mismatch.
    await expect(confirm(preparation.descriptor)).resolves.toMatchObject({ status: 'blocked' });
  });

  it('verifies durable evidence again after the Dexie connection is recreated', async () => {
    // Arrange: complete a reconciliation, then recreate the local database connection.
    const stagedProvider = buildStagedProvider();
    await db.providers.add(stagedProvider);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    await expect(providerConflictRecoveryService.confirmProviderConflictRecovery(preparation.descriptor))
      .resolves.toMatchObject({ status: 'reconciled' });
    db.close();
    await db.open();

    // Act and Assert: reload-safe idempotency requires the evidence and its current postconditions.
    await expect(providerConflictRecoveryService.confirmProviderConflictRecovery(preparation.descriptor))
      .resolves.toMatchObject({ status: 'already-reconciled' });
  });

  it('rebinds selections and plan-mode sessions without changing snapshots or stable IDs', async () => {
    // Arrange: the full staged graph includes one tariff, selection, and plan-priced session.
    const stagedProvider = buildStagedProvider();
    const stagedPlan = buildChargingPlan({ id: 'downstream-plan', provider_id: stagedProvider.id });
    const selection: ProviderPlanSelection = {
      id: 'downstream-selection',
      user_id: 'user-1',
      provider_id: stagedProvider.id,
      tariff_plan_id: stagedPlan.id,
      valid_from: new Date('2026-08-25T00:00:00.000Z'),
      valid_to: null,
      price_snapshot: { label: 'Canonical plan', kWhPrice: 79 },
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    };
    const session: Extract<ChargingSession, { session_mode: 'plan' }> = {
      id: 'downstream-session',
      user_id: 'user-1',
      provider_id: stagedProvider.id,
      provider_name_snapshot: 'Ionity',
      tariff_plan_id: stagedPlan.id,
      plan_selection_id: selection.id,
      charging_plan_name_snapshot: 'Canonical plan',
      session_timestamp: new Date('2026-08-25T10:00:00.000Z'),
      charging_type: 'DC',
      kwh_billed: 10,
      total_cost: 790,
      session_mode: 'plan',
      applied_session_fee: 0,
      created_at: new Date('2026-08-25T10:00:00.000Z'),
      updated_at: new Date('2026-08-25T10:00:00.000Z'),
    };
    await db.providers.add(stagedProvider);
    await db.charging_plans.add(stagedPlan);
    await db.provider_plan_selections.add(selection);
    await db.sessions.add(session);
    const terminalOutboxId = await db.sync_outbox.add(buildTerminalOutbox());
    await db.sync_outbox.bulkAdd([
      { table_name: 'charging_plans', action: 'INSERT', payload: stagedPlan, timestamp: new Date('2026-08-25T10:02:00.000Z') },
      { table_name: 'provider_plan_selections', action: 'INSERT', payload: selection, timestamp: new Date('2026-08-25T10:03:00.000Z') },
      { table_name: 'sessions', action: 'INSERT', payload: session, timestamp: new Date('2026-08-25T10:04:00.000Z') },
    ]);
    const preparation = await prepareProviderConflictRecovery({ userId: 'user-1', terminalOutboxId });
    expect(preparation).toMatchObject({ status: 'ready' });
    if (preparation.status !== 'ready') return;
    const confirm = (providerConflictRecoveryService as {
      confirmProviderConflictRecovery?: (descriptor: ProviderConflictRecoveryDescriptor) => Promise<unknown>;
    }).confirmProviderConflictRecovery;
    expect(confirm).toBeTypeOf('function');
    if (!confirm) return;

    // Act: confirm the complete reviewed graph.
    await confirm(preparation.descriptor);

    // Assert: only relational provider IDs move; immutable snapshots and foreign keys stay intact.
    expect(await db.charging_plans.get(stagedPlan.id)).toMatchObject({ provider_id: 'canonical-provider' });
    expect(await db.provider_plan_selections.get(selection.id)).toEqual({
      ...selection,
      provider_id: 'canonical-provider',
    });
    expect(await db.sessions.get(session.id)).toEqual({
      ...session,
      provider_id: 'canonical-provider',
    });
    const rewrittenOutbox = await db.sync_outbox.toArray();
    expect(rewrittenOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ id: stagedPlan.id, provider_id: 'canonical-provider' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ id: selection.id, provider_id: 'canonical-provider' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ id: session.id, provider_id: 'canonical-provider' }) }),
    ]));
  });
});
