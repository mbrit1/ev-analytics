import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffList } from './TariffList';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';

vi.mock('../hooks/useChargingPlans');
vi.mock('../hooks/useProviders');
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
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p1', name: 'Ionity', user_id: 'u1', created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z') }],
      isLoading: false,
    });
  });

  it('does not render fixed tariff costs and shows domestic prices first', () => {
    // Arrange: Prepare one tariff with domestic, roaming, and fee values.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          name: 'Primary Plan',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 39,
          dc_price_per_kwh: 59,
          roaming_ac_price_per_kwh: 79,
          roaming_dc_price_per_kwh: 99,
          monthly_base_fee: 499,
          session_fee: 129,
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
    expect(screen.getByText(/monthly base fee/i)).toBeInTheDocument();
    expect(screen.getByText(/session fee/i)).toBeInTheDocument();
  });

  it('opens form with preloaded tariff when Edit is clicked', () => {
    // Arrange: Render one tariff and keep loader spy available for prop checks.
    const plan = {
      id: 't1',
      user_id: 'u1',
      provider_id: 'p1',
      name: 'Primary Plan',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 39,
      dc_price_per_kwh: 59 ,
      monthly_base_fee: 0,
      session_fee: 129 ,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [plan],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    render(<TariffList />);

    // Act: Trigger edit mode from card actions.
    fireEvent.click(screen.getByRole('button', { name: /edit ionity primary plan/i }));

    // Assert: Form opens and receives initial values for selected plan.
    expect(screen.getByText('Tariff Form')).toBeInTheDocument();
    expect(mockTariffFormLoader).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialValues: expect.objectContaining({ id: 't1', name: 'Primary Plan' }),
      })
    );
  });

  it('uses shared action button styling for list-level and row-level actions', () => {
    // Arrange: Render one tariff so top and row actions are visible.
    const removeChargingPlan = vi.fn();
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          name: 'Primary Plan',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 39,
      dc_price_per_kwh: 59 ,
      monthly_base_fee: 0,
      session_fee: 129 ,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      addChargingPlan: vi.fn(),
      removeChargingPlan,
      isLoading: false,
    });
    render(<TariffList />);

    // Assert: Primary add action and secondary row actions expose shared styling hooks.
    expect(screen.getByRole('button', { name: /add tariff/i }).className).toContain('bg-accent');
    expect(screen.getByRole('button', { name: /edit/i }).className).toContain('bg-secondary/10');
    expect(screen.getByRole('button', { name: /delete/i }).className).toContain('border-secondary/20');
    expect(screen.getByRole('button', { name: /add tariff/i }).className).toContain('rounded-xl');
    expect(screen.getByRole('button', { name: /edit/i }).className).toContain('rounded-xl');
    expect(screen.getByRole('button', { name: /delete/i }).className).toContain('rounded-xl');
  });

  it('hides optional pricing rows when amounts are zero', () => {
    // Arrange: Render tariff with optional amounts set to zero.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          name: 'Zero Optional Plan',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 45,
          dc_price_per_kwh: 45,
          roaming_ac_price_per_kwh: 0,
          roaming_dc_price_per_kwh: 0,
          monthly_base_fee: 0,
          session_fee: 0,
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

    // Assert: Optional rows are hidden when values are zero.
    expect(screen.queryByText(/roaming ac/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/roaming dc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/monthly base fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/session fee/i)).not.toBeInTheDocument();
  });

  it('renders provider name as card title and only shows non-empty variant subtitle', () => {
    // Arrange: Two tariffs for same provider, only one has a non-empty variant name.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          name: '   ',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 45, dc_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 't2',
          user_id: 'u1',
          provider_id: 'p1',
          name: 'Weekend Saver',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 51, dc_price_per_kwh: 61 ,
      monthly_base_fee: 0,
      session_fee: 0,
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

    // Assert: Provider title is shown; static subtitle is absent; variant appears only when non-empty.
    expect(screen.getAllByRole('heading', { name: 'Ionity', level: 2 })).toHaveLength(2);
    expect(screen.queryByText(/^tariff$/i)).not.toBeInTheDocument();
    expect(screen.getByText('Weekend Saver')).toBeInTheDocument();
    expect(screen.queryByText(/^\s+$/)).not.toBeInTheDocument();
  });

  it('handles empty and whitespace-only plan names without rendering subtitle', () => {
    // Arrange: Provider exists, but variant names are empty or blank.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          name: '',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 45, dc_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 't2',
          user_id: 'u1',
          provider_id: 'p1',
          name: '   ',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 51, dc_price_per_kwh: 61 ,
      monthly_base_fee: 0,
      session_fee: 0,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    // Act: Render list.
    render(<TariffList />);

    // Assert: No variant subtitle for undefined/whitespace and labels stay stable with provider name.
    expect(screen.queryByText(/^tariff$/i)).not.toBeInTheDocument();
    expect(screen.queryByText('   ')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^edit ionity$/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^delete ionity$/i })).toHaveLength(2);
  });

  it('falls back to provider_id when provider lookup misses', () => {
    // Arrange: No providers returned so title/labels should use provider_id fallback.
    vi.mocked(useProviders).mockReturnValue({
      providers: [],
      isLoading: false,
    });
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'provider-fallback',
          name: 'Night Saver',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 45, dc_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    // Act: Render list.
    render(<TariffList />);

    // Assert: Uses provider_id as title and in action labels when lookup is missing.
    expect(screen.getByRole('heading', { name: 'provider-fallback', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit provider-fallback night saver/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete provider-fallback night saver/i })).toBeInTheDocument();
  });
});
