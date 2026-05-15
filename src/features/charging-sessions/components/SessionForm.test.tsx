import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionForm } from './SessionForm';
import { useTariffs } from '../../tariffs/hooks/useTariffs';
import { useProviders } from '../../tariffs/hooks/useProviders';
import { type Tariff, type Provider } from '../../../lib/db';

// Mock the hooks
vi.mock('../../tariffs/hooks/useTariffs');
vi.mock('../../tariffs/hooks/useProviders');
vi.mock('../../auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } })
}));

describe('SessionForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTariffs).mockReturnValue({
      tariffs: [
        { id: 't1', tariff_name: 'Super Tariff', provider_id: 'p1', ac_price_per_kwh: 40, dc_price_per_kwh: 60, session_fee: 0 }
      ] as unknown as Tariff[],
      isLoading: false,
      addTariff: vi.fn(),
      removeTariff: vi.fn(),
    });
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p1', name: 'ChargePoint' }] as unknown as Provider[],
      isLoading: false
    });
  });

  it('renders correctly with required fields', () => {
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    expect(screen.getByLabelText(/date/i)).toBeDefined();
    expect(screen.getByLabelText(/provider/i)).toBeDefined();
    expect(screen.getByLabelText(/tariff/i)).toBeDefined();
    expect(screen.getByText(/charging type/i)).toBeDefined();
    expect(screen.getByLabelText(/kwh billed/i)).toBeDefined();
  });

  it('uses numeric/decimal input modes for mobile optimization', () => {
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    const kwhInput = screen.getByLabelText(/kwh billed/i);
    expect(kwhInput).toHaveAttribute('inputMode', 'decimal');
    
    const startSocInput = screen.getByLabelText(/start soc/i);
    expect(startSocInput).toHaveAttribute('inputMode', 'numeric');
  });

  it.skip('submits correctly with initial values', async () => {
    const initialValues = {
      session_timestamp: new Date('2024-05-15'),
      provider_id: 'p1',
      tariff_id: 't1',
      kwh_billed: 25.5,
      start_soc_percentage: 20,
      end_soc_percentage: 80,
      location_type: 'Public' as const,
      charging_type: 'AC' as const,
    };
    
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);
    
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));
    
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
  });
});
