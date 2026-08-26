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
});
