import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargingHistory } from './ChargingHistory';
import { useSessions } from '../hooks/useSessions';
import { type ChargingSession } from '../../../infra/db';

// Mock the hook to cover rendering states without depending on IndexedDB.
vi.mock('../hooks/useSessions');

/**
 * Test suite for charging history rendering.
 *
 * Verifies session row content, localized values, sync status badges, and the
 * empty state while the data hook is mocked.
 */
describe('ChargingHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a list of sessions', () => {
    // Arrange: Return one pending-sync session from the mocked hook.
    vi.mocked(useSessions).mockReturnValue({
      sessions: [
        { 
          id: 's1', 
          session_timestamp: new Date('2024-05-14T10:00:00Z'),
          provider_name: 'Tesla',
          tariff_name: 'Supercharger',
          charging_type: 'DC',
          kwh_billed: 45.5,
          total_cost: 2275, // 22.75 EUR
          location_type: 'Fast Charger'
        } as unknown as ChargingSession
      ],
      isLoading: false,
      pendingSyncIds: new Set(['s1']),
    });

    // Act: Render the history view.
    render(<ChargingHistory />);
    
    // Assert: Session details and pending sync status are visible.
    expect(screen.getByText(/tesla/i)).toBeDefined();
    expect(screen.getByText(/supercharger/i)).toBeDefined();
    expect(screen.getByText(/45,5/)).toBeDefined();
    expect(screen.getByText(/22,75 €/)).toBeDefined();
    expect(screen.getByText(/pending sync/i)).toBeDefined();
  });

  it('renders empty state when no sessions', () => {
    // Arrange: Return an empty session collection from the mocked hook.
    vi.mocked(useSessions).mockReturnValue({
      sessions: [],
      isLoading: false,
      pendingSyncIds: new Set(),
    });

    // Act: Render the history view.
    render(<ChargingHistory />);
    
    // Assert: The empty-state message is shown.
    expect(screen.getByText(/no sessions/i)).toBeDefined();
  });
});
