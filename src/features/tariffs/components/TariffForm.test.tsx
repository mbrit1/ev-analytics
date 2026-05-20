import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffForm } from './TariffForm';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth/hooks/useAuth';

// Mock hooks and provider persistence so form tests stay focused on rendered
// inputs instead of IndexedDB state.
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
    // Price fields should use the compact horizontal ThinInput treatment used
    // for values with units.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    const acPriceInput = screen.getByLabelText(/ac price/i);
    const acPriceWrapper = acPriceInput.closest('.md\\:flex-row');
    expect(acPriceWrapper).toBeDefined();
    expect(acPriceWrapper).toHaveClass('md:items-center');

    const dcPriceInput = screen.getByLabelText(/dc price/i);
    const dcPriceWrapper = dcPriceInput.closest('.md\\:flex-row');
    expect(dcPriceWrapper).toBeDefined();
    expect(dcPriceWrapper).toHaveClass('md:items-center');

    const sessionFeeInput = screen.getByLabelText(/session fee/i);
    const sessionFeeWrapper = sessionFeeInput.closest('.md\\:flex-row');
    expect(sessionFeeWrapper).toBeDefined();
    expect(sessionFeeWrapper).toHaveClass('md:items-center');
  });

  it('uses numeric/decimal input modes for mobile optimization', () => {
    // Values remain strings until submit, so inputMode supplies the right mobile
    // keyboard without changing form parsing behavior.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    expect(screen.getByLabelText(/ac price/i)).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText(/dc price/i)).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText(/session fee/i)).toHaveAttribute('inputMode', 'decimal');
  });
});
