import { describe, expect, it } from 'vitest';
import type { Provider } from './db';
import { createSyncOutboxEntry } from './outbox';

/**
 * Test suite for fresh sync-outbox entry construction.
 *
 * Verifies caller data is preserved and retry metadata starts in a clean state.
 */
describe('createSyncOutboxEntry', () => {
  it('preserves mutation data and initializes retry metadata', () => {
    // Arrange
    const timestamp = new Date('2026-07-11T12:00:00.000Z');
    const provider: Provider = {
      id: 'provider-1',
      user_id: 'user-1',
      name: 'Provider',
      created_at: timestamp,
      updated_at: timestamp,
    };

    // Act
    const entry = createSyncOutboxEntry('providers', 'INSERT', provider, timestamp);

    // Assert
    expect(entry).toEqual({
      table_name: 'providers',
      action: 'INSERT',
      payload: provider,
      timestamp,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined,
    });
    expect(entry.payload).toBe(provider);
    expect(entry.timestamp).toBe(timestamp);
  });
});
