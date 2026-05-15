import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessions } from './useSessions';
import { getSessions } from '../services/sessionService';
import { type ChargingSession } from '../../../lib/db';

// Mock the service
vi.mock('../services/sessionService');

describe('useSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches sessions and handles loading state', async () => {
    vi.mocked(getSessions).mockResolvedValue([
      { id: 's1', session_timestamp: new Date() }
    ] as unknown as ChargingSession[]);

    const { result } = renderHook(() => useSessions());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('s1');
  });
});
