import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffForm } from './TariffForm';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth';

// Mock hooks and provider persistence so form tests stay focused on rendered
// inputs instead of IndexedDB state.
vi.mock('../hooks/useProviders');
vi.mock('../../auth');
vi.mock('../services/providerService');

/**
 * Test suite for the tariff form.
 *
 * Verifies unit-bearing price fields render with the intended horizontal layout
 * and mobile decimal keyboard hints while dependencies are mocked.
 */
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
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it('renders numeric fields with horizontal layout', () => {
    // Arrange: Render the tariff form with mocked provider/auth hooks.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    // Assert: Price fields use the compact horizontal ThinInput treatment.
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
    // Arrange: Render the tariff form with default values.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    // Assert: Price fields request decimal keyboards on mobile.
    expect(screen.getByLabelText(/ac price/i)).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText(/dc price/i)).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText(/session fee/i)).toHaveAttribute('inputMode', 'decimal');
  });
});

/**
 * Test suite for the tariff form loader.
 *
 * Verifies the lazy wrapper renders a loading fallback and forwards callbacks
 * to the deferred TariffForm implementation.
 */
describe('TariffFormLoader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders loading fallback while lazy form module resolves', async () => {
    // Arrange: Mock TariffForm with a delayed module resolution.
    vi.doMock('./TariffForm', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        TariffForm: () => <div>Lazy Tariff Form</div>,
      };
    });
    const { TariffFormLoader } = await import('./TariffFormLoader');

    // Act: Render lazy loader and assert immediate fallback.
    render(<TariffFormLoader onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // Assert: Fallback appears before deferred module renders.
    expect(screen.getByText(/loading tariff form/i)).toBeInTheDocument();
    expect(await screen.findByText('Lazy Tariff Form')).toBeInTheDocument();
  });

  it('forwards props to the lazy-loaded tariff form', async () => {
    // Arrange: Track props received by deferred TariffForm.
    const received = vi.fn();
    vi.doMock('./TariffForm', async () => ({
      TariffForm: (props: unknown) => {
        received(props);
        return <div>Deferred Form</div>;
      },
    }));
    const { TariffFormLoader } = await import('./TariffFormLoader');
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const initialValues = { tariff_name: 'Workday' };

    // Act: Render lazy loader and wait for the deferred form.
    render(<TariffFormLoader onSubmit={onSubmit} onCancel={onCancel} initialValues={initialValues} />);
    await screen.findByText('Deferred Form');

    // Assert: Loader passes through form contract unchanged.
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        onSubmit,
        onCancel,
        initialValues,
      })
    );
  });
});
