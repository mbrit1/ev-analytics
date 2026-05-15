import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargingHistory } from './ChargingHistory';
import { useSessions } from '../hooks/useSessions';

// Mock the hook
vi.mock('../hooks/useSessions');

describe('ChargingHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a list of sessions', () => {
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
        } as unknown as any
      ],
      isLoading: false,
      pendingSyncIds: new Set(['s1']),
    });

    render(<ChargingHistory />);
    
    expect(screen.getByText(/tesla/i)).toBeDefined();
    expect(screen.getByText(/supercharger/i)).toBeDefined();
    expect(screen.getByText(/45,5/)).toBeDefined();
    expect(screen.getByText(/22,75 €/)).toBeDefined();
    expect(screen.getByText(/pending sync/i)).toBeDefined();
  });

  it('renders empty state when no sessions', () => {
    vi.mocked(useSessions).mockReturnValue({
      sessions: [],
      isLoading: false,
      pendingSyncIds: new Set(),
    });

    render(<ChargingHistory />);
    
    expect(screen.getByText(/no sessions/i)).toBeDefined();
  });
});
