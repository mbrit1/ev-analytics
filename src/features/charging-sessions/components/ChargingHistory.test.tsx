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
 * Verifies session row content, localized values, ad-hoc details, and the
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
          provider_name_snapshot: 'Tesla',
          charging_plan_name_snapshot: 'Supercharger',
          charging_type: 'DC',
          kwh_billed: 45.5,
          total_cost: 2275, // 22.75 EUR
          session_mode: 'plan',
          price_snapshot: { label: 'Supercharger', kWhPrice: 50 }
        } as unknown as ChargingSession
      ],
      isLoading: false,
      pendingSyncIds: new Set(['s1']),
    });

    // Act: Render the history view.
    render(<ChargingHistory />);
    
    // Assert: Session details are visible and per-row sync badges are omitted.
    expect(screen.getByText(/tesla/i)).toBeDefined();
    expect(screen.getByText(/supercharger/i)).toBeDefined();
    expect(screen.getByText(/45,5/)).toBeDefined();
    expect(screen.getByText(/22,75/)).toBeDefined();
    expect(screen.queryByText(/pending sync/i)).toBeNull();
    expect(screen.queryByText(/synced/i)).toBeNull();
  });

  it('renders ad-hoc sessions with cpo/source details without extra price lines', () => {
    // Arrange: Return one synced ad-hoc session with pricing snapshot details.
    vi.mocked(useSessions).mockReturnValue({
      sessions: [
        {
          id: 's2',
          session_timestamp: new Date('2024-05-20T10:00:00Z'),
          provider_name_snapshot: 'Fast CPO',
          charging_plan_name_snapshot: null,
          charging_type: 'DC',
          kwh_billed: 20,
          total_cost: 1780,
          session_mode: 'adHoc',
          pricing_source: 'adHoc',
          ad_hoc_pricing: {
            cpoName: 'Fast CPO',
            pricePerKwh: 69,
            pricePerSession: 150,
            receiptUrl: 'https://example.com/r/1',
            otherFees: [{ label: 'Parking', amount: 200, notes: 'Garage fee' }]
          }
        } as unknown as ChargingSession
      ],
      isLoading: false,
      pendingSyncIds: new Set(),
    });

    // Act: Render history.
    render(<ChargingHistory />);

    // Assert: Ad-hoc labeling is visible, detailed price lines are hidden.
    expect(screen.getByText(/ad-hoc/i)).toBeDefined();
    expect(screen.getAllByText(/fast cpo/i).length).toBeGreaterThan(0);
    expect(screen.queryByText((content) => content.includes('/kWh'))).toBeNull();
    expect(screen.queryByText((content) => content.includes('/session'))).toBeNull();
    expect(screen.queryByText(/receipt: https:\/\/example\.com\/r\/1/i)).toBeNull();
    expect(screen.queryByText(/parking/i)).toBeNull();
    expect(screen.queryByText(/soc/i)).toBeNull();
    expect(screen.queryByText(/pending sync/i)).toBeNull();
    expect(screen.queryByText(/synced/i)).toBeNull();
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
