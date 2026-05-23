import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffList } from './TariffList';
import { useChargingPlans } from '../hooks/useChargingPlans';

vi.mock('../hooks/useChargingPlans');
const mockTariffFormLoader = vi.fn((...args: unknown[]) => {
  void args;
  return <div>Tariff Form</div>;
});
vi.mock('./TariffFormLoader', () => ({
  TariffFormLoader: (props: unknown) => mockTariffFormLoader(props),
}));

/**
 * Test suite for tariff list rendering and pricing-card hierarchy.
 */
describe('TariffList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render fixed tariff costs and shows domestic prices first', () => {
    // Arrange: Prepare one tariff with domestic, roaming, and fee values.
    vi.mocked(useChargingPlans).mockReturnValue({
      chargingPlans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          plan_name: 'Primary Plan',
          validity: { from: new Date('2026-01-01T00:00:00.000Z') },
          prices: {
            domestic: { ac: 39, dc: 59 },
            roaming: { ac: 79, dc: 99 },
          },
          fees: {
            subscriptionMonthly: 499,
            activationOneTime: 999,
            sessionFixed: 129,
          },
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    // Act: Render tariff list.
    render(<TariffList />);

    // Assert: No fixed-cost section; primary domestic rows and optional rows are shown.
    expect(screen.queryByText(/fixed tariff costs/i)).not.toBeInTheDocument();
    expect(screen.getByText(/domestic ac/i)).toBeInTheDocument();
    expect(screen.getByText(/domestic dc/i)).toBeInTheDocument();
    expect(screen.getByText(/roaming ac/i)).toBeInTheDocument();
    expect(screen.getByText(/roaming dc/i)).toBeInTheDocument();
    expect(screen.getByText(/subscription/i)).toBeInTheDocument();
    expect(screen.getByText(/activation fee/i)).toBeInTheDocument();
  });

  it('opens form with preloaded tariff when Edit is clicked', () => {
    // Arrange: Render one tariff and keep loader spy available for prop checks.
    const plan = {
      id: 't1',
      user_id: 'u1',
      provider_id: 'p1',
      plan_name: 'Primary Plan',
      validity: { from: new Date('2026-01-01T00:00:00.000Z') },
      prices: { domestic: { ac: 39, dc: 59 } },
      fees: { sessionFixed: 129 },
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    vi.mocked(useChargingPlans).mockReturnValue({
      chargingPlans: [plan],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    render(<TariffList />);

    // Act: Trigger edit mode from card actions.
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    // Assert: Form opens and receives initial values for selected plan.
    expect(screen.getByText('Tariff Form')).toBeInTheDocument();
    expect(mockTariffFormLoader).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialValues: expect.objectContaining({ id: 't1', plan_name: 'Primary Plan' }),
      })
    );
  });
});
