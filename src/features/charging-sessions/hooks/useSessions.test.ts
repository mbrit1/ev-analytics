import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessions } from './useSessions';
import { getSessions } from '../services/sessionService';
import { type ChargingSession } from '../../../lib/db';

// Mock the service so the hook test can focus on live-query state transitions.
vi.mock('../services/sessionService');

/**
 * Test suite for the charging-session live query hook.
 *
 * Verifies loading-state normalization and session exposure from the service
 * layer without depending on real IndexedDB contents.
 */
describe('useSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches sessions and handles loading state', async () => {
    // Arrange: Mock one resolved session from the service layer.
    vi.mocked(getSessions).mockResolvedValue([
      { id: 's1', session_timestamp: new Date() }
    ] as unknown as ChargingSession[]);

    // Act: Render the hook and let the live query resolve.
    const { result } = renderHook(() => useSessions());

    // Assert: The hook reports loading before the async query resolves.
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: Resolved sessions are exposed as a normalized array.
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('s1');
  });
});
