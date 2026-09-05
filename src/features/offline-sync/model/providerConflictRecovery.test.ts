import { describe, expect, it } from 'vitest';
import { createProviderConflictRecoveryReviewVersion } from './providerConflictRecovery';

/**
 * Contract tests for the opaque review version guarding recovery confirmation.
 *
 * The token must encode all supplied safety-relevant values canonically rather
 * than relying on JavaScript object insertion order or lossy JSON semantics.
 */
describe('createProviderConflictRecoveryReviewVersion', () => {
  it('canonically distinguishes null and undefined while ignoring object-key order', () => {
    // Arrange: equivalent objects differ only in property insertion order.
    const left = { provider: { id: 'canonical', deleted_at: null }, retry: undefined };
    const right = { retry: undefined, provider: { deleted_at: null, id: 'canonical' } };

    // Act and Assert: order is stable, while null and undefined remain distinct.
    expect(createProviderConflictRecoveryReviewVersion(left))
      .toBe(createProviderConflictRecoveryReviewVersion(right));
    expect(createProviderConflictRecoveryReviewVersion({ value: null }))
      .not.toBe(createProviderConflictRecoveryReviewVersion({ value: undefined }));
  });

  it('changes when a retry field, remote row, or UTC date changes', () => {
    // Arrange: each field participates in stale-review protection.
    const baseline = {
      outbox: { id: 7, action: 'INSERT', retry_count: 1, next_attempt_at: undefined },
      remote: { id: 'canonical', updated_at: '2026-08-25T10:00:00.000Z' },
    };

    // Act and Assert: no safety-relevant mutation can preserve the token.
    expect(createProviderConflictRecoveryReviewVersion(baseline))
      .not.toBe(createProviderConflictRecoveryReviewVersion({
        ...baseline,
        outbox: { ...baseline.outbox, retry_count: 2 },
      }));
    expect(createProviderConflictRecoveryReviewVersion(baseline))
      .not.toBe(createProviderConflictRecoveryReviewVersion({
        ...baseline,
        remote: { ...baseline.remote, updated_at: '2026-08-26T10:00:00.000Z' },
      }));
  });

  it.each([
    ['outbox table', (value: Record<string, unknown>) => ({
      ...value,
      outbox: { ...(value.outbox as object), table_name: 'sessions' },
    })],
    ['outbox action', (value: Record<string, unknown>) => ({
      ...value,
      outbox: { ...(value.outbox as object), action: 'DELETE' },
    })],
    ['outbox timestamp', (value: Record<string, unknown>) => ({
      ...value,
      outbox: { ...(value.outbox as object), timestamp: new Date('2026-08-26T10:00:00.000Z') },
    })],
    ['outbox payload', (value: Record<string, unknown>) => ({
      ...value,
      outbox: {
        ...(value.outbox as object),
        payload: { ...((value.outbox as { payload: object }).payload), notes: 'changed' },
      },
    })],
    ['remote selected field', (value: Record<string, unknown>) => ({ ...value, canonical: { ...value.canonical as object, name: 'Renamed' } })],
    ['array order', (value: Record<string, unknown>) => ({ ...value, affectedIds: [...value.affectedIds as string[]].reverse() })],
  ])('changes when the %s changes', (_label, mutate) => {
    // Arrange: every review manifest field must participate in stale confirmation protection.
    const baseline: Record<string, unknown> = {
      authenticatedUserId: 'user-1',
      outbox: {
        id: 7,
        table_name: 'providers',
        action: 'INSERT',
        timestamp: new Date('2026-08-25T10:00:00.000Z'),
        retry_count: 1,
        last_attempt_at: new Date('2026-08-25T10:00:01.000Z'),
        next_attempt_at: undefined,
        last_error: 'Safe error',
        failure_kind: 'provider-name-conflict',
        payload: { id: 'staged', flags: [null, undefined] },
      },
      canonical: {
        id: 'canonical',
        name: 'Ionity',
        created_at: new Date('2026-08-25T09:00:00.000Z'),
        updated_at: new Date('2026-08-25T10:00:00.000Z'),
        deleted_at: null,
      },
      affectedIds: ['plan-1', 'selection-1', 'session-1'],
    };

    // Act and Assert: manifest mutation must invalidate the opaque review token.
    expect(createProviderConflictRecoveryReviewVersion(mutate(baseline)))
      .not.toBe(createProviderConflictRecoveryReviewVersion(baseline));
  });

  it('includes every persisted review section while keeping equivalent sorted rows deterministic', () => {
    // Arrange: these are the complete top-level review sections assembled after local row sorting.
    const baseline = {
      authenticatedUserId: 'user-1',
      terminalOutbox: { id: 11, table_name: 'providers', action: 'INSERT', retry_count: 1, payload: { id: 'staged' } },
      stagedProvider: { id: 'staged', name: 'Ionity', created_at: new Date('2026-08-25T09:00:00.000Z') },
      canonicalProvider: { id: 'canonical', name: 'IONITY', deleted_at: null },
      local: {
        plans: [{ id: 'plan-a', provider_id: 'staged', deleted_at: undefined }],
        selections: [{ id: 'selection-a', provider_id: 'staged', price_snapshot: { label: 'Ionity', kWhPrice: 79 } }],
        sessions: [{ id: 'session-a', provider_id: 'staged', session_timestamp: new Date('2026-08-25T10:00:00.000Z') }],
        outbox: [{ id: 12, table_name: 'charging_plans', action: 'DELETE', retry_count: 2, payload: { id: 'plan-a' } }],
      },
      remote: {
        canonicalPlans: [{ id: 'canonical-plan', provider_id: 'canonical', valid_to: null }],
        affectedSelections: [{ id: 'selection-a', provider_id: 'canonical', deleted_at: null }],
        affectedSessions: [{ id: 'session-a', provider_id: 'canonical', plan_selection_id: undefined }],
      },
    };
    const mutations = [
      { ...baseline, authenticatedUserId: 'user-2' },
      { ...baseline, terminalOutbox: { ...baseline.terminalOutbox, action: 'DELETE' } },
      { ...baseline, stagedProvider: { ...baseline.stagedProvider, name: 'Changed' } },
      { ...baseline, canonicalProvider: { ...baseline.canonicalProvider, name: 'Changed' } },
      { ...baseline, local: { ...baseline.local, plans: [{ ...baseline.local.plans[0], provider_id: 'changed' }] } },
      { ...baseline, local: { ...baseline.local, selections: [{ ...baseline.local.selections[0], provider_id: 'changed' }] } },
      { ...baseline, local: { ...baseline.local, sessions: [{ ...baseline.local.sessions[0], provider_id: 'changed' }] } },
      { ...baseline, local: { ...baseline.local, outbox: [{ ...baseline.local.outbox[0], retry_count: 3 }] } },
      { ...baseline, remote: { ...baseline.remote, canonicalPlans: [{ ...baseline.remote.canonicalPlans[0], provider_id: 'changed' }] } },
      { ...baseline, remote: { ...baseline.remote, affectedSelections: [{ ...baseline.remote.affectedSelections[0], provider_id: 'changed' }] } },
      { ...baseline, remote: { ...baseline.remote, affectedSessions: [{ ...baseline.remote.affectedSessions[0], provider_id: 'changed' }] } },
    ];

    // Act and Assert: every selected field and retry/action/payload section invalidates a stale review.
    for (const mutation of mutations) {
      expect(createProviderConflictRecoveryReviewVersion(mutation))
        .not.toBe(createProviderConflictRecoveryReviewVersion(baseline));
    }
    expect(createProviderConflictRecoveryReviewVersion({ rows: [{ id: 'a' }, { id: 'b' }] }))
      .toBe(createProviderConflictRecoveryReviewVersion({ rows: [{ id: 'a' }, { id: 'b' }] }));
  });

  it('invalidates the review token for every leaf in the complete provider, plan, selection, session, and outbox manifest', () => {
    // Arrange: this mirrors every persisted field supplied to the review serializer by recovery preparation.
    const fullManifest = {
      terminalOutbox: {
        id: 1, table_name: 'providers', action: 'INSERT', timestamp: new Date('2026-08-25T10:00:00.000Z'),
        retry_count: 1, last_attempt_at: new Date('2026-08-25T10:01:00.000Z'), next_attempt_at: undefined,
        last_error: 'Safe error', failure_kind: 'provider-name-conflict', payload: { id: 'staged', user_id: 'user-1', name: 'Ionity', created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: undefined },
      },
      stagedProvider: { id: 'staged', user_id: 'user-1', name: 'Ionity', created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: undefined },
      canonicalProvider: { id: 'canonical', user_id: 'user-1', name: 'IONITY', created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: null },
      local: {
        plans: [{ id: 'plan', user_id: 'user-1', provider_id: 'staged', name: 'Plan', valid_from: new Date('2026-08-25T00:00:00.000Z'), valid_to: null, ac_price_per_kwh: 79, dc_price_per_kwh: 89, roaming_ac_price_per_kwh: 99, roaming_dc_price_per_kwh: 109, monthly_base_fee: 199, session_fee: 29, affiliation: 'member', notes: 'note', created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: undefined }],
        selections: [{ id: 'selection', user_id: 'user-1', provider_id: 'staged', tariff_plan_id: 'plan', valid_from: new Date('2026-08-25T00:00:00.000Z'), valid_to: null, price_snapshot: { label: 'Plan', kWhPrice: 79, sessionFee: 29, blockingFee: 0 }, created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: undefined }],
        sessions: [{ id: 'session', user_id: 'user-1', session_timestamp: new Date('2026-08-25T10:00:00.000Z'), provider_id: 'staged', provider_name_snapshot: 'Ionity', charging_plan_name_snapshot: 'Plan', charging_type: 'DC', kwh_billed: 10, kwh_added: null, total_cost: 790, session_mode: 'plan', tariff_plan_id: 'plan', ad_hoc_pricing: undefined, plan_selection_id: 'selection', price_snapshot: { label: 'Plan' }, odometer_km: undefined, start_soc_percentage: null, end_soc_percentage: 80, notes: 'note', applied_price_per_kwh: 79, applied_ac_price_per_kwh: null, applied_dc_price_per_kwh: 79, applied_roaming_ac_price_per_kwh: null, applied_roaming_dc_price_per_kwh: null, applied_monthly_base_fee: 199, applied_session_fee: 29, created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: undefined }],
        outbox: [{ id: 2, table_name: 'charging_plans', action: 'UPDATE', timestamp: new Date('2026-08-25T10:00:00.000Z'), retry_count: 2, last_attempt_at: new Date('2026-08-25T10:01:00.000Z'), next_attempt_at: undefined, last_error: 'Safe error', failure_kind: undefined, payload: { id: 'plan', provider_id: 'staged', name: 'Plan' } }],
      },
      remote: {
        canonicalPlans: [{ id: 'canonical-plan', user_id: 'user-1', provider_id: 'canonical', name: 'Remote plan', valid_from: new Date('2026-08-25T00:00:00.000Z'), valid_to: null, ac_price_per_kwh: 79, dc_price_per_kwh: 89, roaming_ac_price_per_kwh: 99, roaming_dc_price_per_kwh: 109, monthly_base_fee: 199, session_fee: 29, affiliation: 'member', notes: 'note', created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: null }],
        affectedSelections: [{ id: 'selection', user_id: 'user-1', provider_id: 'canonical', tariff_plan_id: 'plan', valid_from: new Date('2026-08-25T00:00:00.000Z'), valid_to: null, price_snapshot: { label: 'Plan', kWhPrice: 79 }, created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: null }],
        affectedSessions: [{ id: 'session', user_id: 'user-1', provider_id: 'canonical', tariff_plan_id: 'plan', plan_selection_id: 'selection', session_mode: 'plan', created_at: new Date('2026-08-25T09:00:00.000Z'), updated_at: new Date('2026-08-25T10:00:00.000Z'), deleted_at: null }],
      },
    };
    const leafPaths = (value: unknown, path: Array<string | number> = []): Array<Array<string | number>> => {
      if (value === null || value === undefined || value instanceof Date || typeof value !== 'object') return [path];
      if (Array.isArray(value)) return value.flatMap((entry, index) => leafPaths(entry, [...path, index]));
      return Object.entries(value).flatMap(([key, entry]) => leafPaths(entry, [...path, key]));
    };
    const replaceLeaf = (value: Record<string | number, unknown>, path: Array<string | number>, replacement: unknown) => {
      let target: Record<string | number, unknown> = value;
      for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
      target[path.at(-1)!] = replacement;
    };

    // Act and Assert: no leaf can change while preserving the opaque token.
    const baseline = createProviderConflictRecoveryReviewVersion(fullManifest);
    for (const [index, path] of leafPaths(fullManifest).entries()) {
      const mutation = structuredClone(fullManifest) as Record<string | number, unknown>;
      replaceLeaf(mutation, path, `changed-${index}`);
      expect(createProviderConflictRecoveryReviewVersion(mutation)).not.toBe(baseline);
    }
  });
});
