import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffForm } from './TariffForm';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth/hooks/useAuth';

// Mock the hooks
vi.mock('../hooks/useProviders');
vi.mock('../../auth/hooks/useAuth');
vi.mock('../services/providerService');

describe('TariffForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p1', name: 'ChargePoint', user_id: 'user-1', created_at: new Date(), updated_at: new Date() }],
      isLoading: false
    });
    vi.mocked(useAuth).mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: { id: 'user-1' } as any,
      loading: false,
      session: null,
    });
  });

  it('renders numeric fields with horizontal layout', () => {
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    // Check for AC Price
    const acPriceInput = screen.getByLabelText(/ac price/i);
    const acPriceWrapper = acPriceInput.closest('.md\\:flex-row');
    expect(acPriceWrapper).toBeDefined();
    expect(acPriceWrapper).toHaveClass('md:items-center');

    // Check for DC Price
    const dcPriceInput = screen.getByLabelText(/dc price/i);
    const dcPriceWrapper = dcPriceInput.closest('.md\\:flex-row');
    expect(dcPriceWrapper).toBeDefined();
    expect(dcPriceWrapper).toHaveClass('md:items-center');

    // Check for Session Fee
    const sessionFeeInput = screen.getByLabelText(/session fee/i);
    const sessionFeeWrapper = sessionFeeInput.closest('.md\\:flex-row');
    expect(sessionFeeWrapper).toBeDefined();
    expect(sessionFeeWrapper).toHaveClass('md:items-center');
  });

  it('uses numeric/decimal input modes for mobile optimization', () => {
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    expect(screen.getByLabelText(/ac price/i)).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText(/dc price/i)).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText(/session fee/i)).toHaveAttribute('inputMode', 'decimal');
  });
});
