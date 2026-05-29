import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
 * Test suite for tariff form sections, validation, and charging-plan payload mapping.
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

  it('renders grouped tariff sections', () => {
    // Arrange: Render the tariff form with mocked provider/auth hooks.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Grouped sections match task requirements.
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Charging Prices')).toBeInTheDocument();
    expect(screen.getByText('Roaming Prices')).toBeInTheDocument();
    expect(screen.getByText('Additional Fees')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText(/required fields/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identity' })).toHaveAttribute('id', 'tariff-section-identity');
    expect(screen.getByRole('heading', { name: 'Charging Prices' })).toHaveAttribute('id', 'tariff-section-charging-prices');
  });

  it('uses polished action-row styling hooks for submit and cancel actions', () => {
    // Arrange: Render the tariff form.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Buttons expose shared visual contract classes used by session workflows.
    const saveButton = screen.getByRole('button', { name: /save tariff/i });
    const cancelButton = screen.getByText('Cancel').closest('button');
    expect(cancelButton).toBeTruthy();
    expect(saveButton.className).toContain('bg-accent');
    expect(saveButton.className).toContain('rounded-xl');
    expect(saveButton.className).toContain('min-h-[56px]');
    expect(cancelButton?.className).toContain('bg-secondary/10');
    expect(cancelButton?.className).toContain('rounded-xl');
    expect(cancelButton?.className).toContain('min-h-[56px]');
  });

  it('rejects other fees when label, amount, or notes are missing', async () => {
    // Arrange: Render and fill minimum valid identity fields.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'Home Tariff' } });
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });

    // Act: Fill partial "other fee" and submit.
    fireEvent.change(screen.getByLabelText(/other fee label/i), { target: { value: 'Parking' } });
    fireEvent.change(screen.getByLabelText(/other fee amount/i), { target: { value: '1,50' } });
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Submission is blocked unless notes are also provided.
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  it('submits nested charging-plan payload', async () => {
    // Arrange: Render and enter tariff inputs across grouped sections.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'Travel Tariff' } });
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,49' } });
    fireEvent.change(screen.getByLabelText(/^dc price$/i), { target: { value: '0,59' } });
    fireEvent.change(screen.getByLabelText(/roaming ac price/i), { target: { value: '0,69' } });
    fireEvent.change(screen.getByLabelText(/roaming dc price/i), { target: { value: '0,79' } });
    fireEvent.change(screen.getByLabelText(/subscription/i), { target: { value: '3,99' } });
    fireEvent.change(screen.getByLabelText(/activation fee/i), { target: { value: '9,99' } });
    fireEvent.change(screen.getByLabelText(/session fee/i), { target: { value: '0,99' } });
    fireEvent.change(screen.getByLabelText(/card fee/i), { target: { value: '2,99' } });
    fireEvent.change(screen.getByLabelText(/other fee label/i), { target: { value: 'Parking' } });
    fireEvent.change(screen.getByLabelText(/other fee amount/i), { target: { value: '1,50' } });
    fireEvent.change(screen.getByLabelText(/other fee notes/i), { target: { value: 'Per charge' } });
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Form maps browser strings to nested charging-plan payload.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_name: 'Travel Tariff',
        provider_id: 'p1',
        prices: expect.objectContaining({
          domestic: { ac: 49, dc: 59 },
          roaming: { ac: 69, dc: 79 },
        }),
        fees: expect.objectContaining({
          subscriptionMonthly: 399,
          activationOneTime: 999,
          sessionFixed: 99,
          cardFee: 299,
          other: [{ label: 'Parking', amount: 150, notes: 'Per charge' }],
        }),
      })
    );
  });

  it('allows submit when tariff name is empty', async () => {
    // Arrange: Fill only required fields without tariff name.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });

    // Act: Submit with empty tariff name.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Submission succeeds and persists empty plan_name.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_name: '',
        provider_id: 'p1',
      })
    );
  });

  it('normalizes whitespace-only tariff name to empty string', async () => {
    // Arrange: Enter whitespace tariff name with required provider.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/tariff name \(optional\)/i), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });

    // Act: Submit form.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Whitespace is normalized before persistence.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_name: '',
      })
    );
  });

  it('shows invariant save error and preserves user input values', async () => {
    // Arrange: Rejected save for duplicate unnamed tariff.
    mockOnSubmit.mockRejectedValueOnce(new Error('Only one unnamed tariff is allowed per provider'));
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,45' } });
    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: 'my draft notes' } });

    // Act: Submit and let save reject.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Error is announced and form entries remain intact.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Only one unnamed tariff is allowed per provider');
    expect(screen.getByLabelText(/^provider$/i)).toHaveValue('p1');
    expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,45');
    expect(screen.getByLabelText(/^notes$/i)).toHaveValue('my draft notes');
  });

  it('exposes provider validation with aria attributes', async () => {
    // Arrange: Make provider required fail while other required fields are present.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'No Provider Tariff' } });
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Provider select exposes invalid + error relationship for assistive tech.
    const providerSelect = screen.getByLabelText(/^provider$/i);
    await waitFor(() => {
      expect(providerSelect).toHaveAttribute('aria-invalid', 'true');
      expect(providerSelect).toHaveAttribute('aria-describedby');
    });
    const providerError = screen.getByText(/provider is required/i);
    expect(providerError.id).toBe(providerSelect.getAttribute('aria-describedby'));
  });

  it('renders stored UTC dates without timezone drift in edit mode', () => {
    // Arrange: Use a UTC midnight date that can drift in local timezone formatting.
    render(
      <TariffForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{
          plan_name: 'UTC Tariff',
          provider_id: 'p1',
          validity: {
            from: new Date('2026-01-01T00:00:00.000Z'),
            to: new Date('2026-01-31T00:00:00.000Z'),
          },
        }}
      />
    );

    // Assert: Date inputs preserve UTC calendar date in yyyy-mm-dd.
    expect(screen.getByLabelText(/valid from/i)).toHaveValue('2026-01-01');
    expect(screen.getByLabelText(/valid to/i)).toHaveValue('2026-01-31');
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
    const initialValues = { plan_name: 'Workday' };

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
