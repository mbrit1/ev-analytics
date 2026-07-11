import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffForm } from './TariffForm';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth';

// Mock hooks and provider persistence so form tests stay focused on rendered
// inputs instead of IndexedDB state.
vi.mock('../hooks/useProviders');
vi.mock('../../auth');
vi.mock('../services/providerService');

function getPickerMonth(): string {
  const monthHeading = screen.getByTestId('date-picker-month');
  const month = monthHeading.getAttribute('data-month');
  if (!month) {
    throw new Error('Date picker month heading is missing data-month');
  }
  return month;
}

function movePickerToMonth(targetDate: string): void {
  const targetMonth = targetDate.slice(0, 7);
  let guard = 0;

  while (getPickerMonth() !== targetMonth) {
    if (guard > 48) {
      throw new Error(`Could not navigate date picker to ${targetMonth}`);
    }
    const currentMonth = getPickerMonth();
    fireEvent.click(screen.getByRole('button', {
      name: currentMonth.localeCompare(targetMonth) < 0 ? /next month/i : /previous month/i,
    }));
    guard += 1;
  }
}

function formatPickerLabel(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function pickDate(label: RegExp, date: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
  movePickerToMonth(date);
  fireEvent.click(screen.getByRole('button', { name: `Choose ${formatPickerLabel(date)}` }));
  const applyButton = screen.queryByRole('button', { name: /apply/i });
  fireEvent.click(applyButton ?? screen.getByRole('button', { name: /set date/i }));
}

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

    // Act: Inspect the rendered section headings.

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

  it('uses explicit mode to determine the standard form title', () => {
    // Arrange: Render standard mode with an existing id but create-mode intent.
    render(
      <TariffForm
        mode="create"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{ id: 'existing-id', provider_id: 'p1', name: 'Draft Tariff' }}
      />
    );

    // Act: Inspect the shell title.

    // Assert: Title follows the explicit mode contract rather than inferred id presence.
    expect(screen.getByRole('heading', { name: 'New Tariff' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Edit Tariff' })).not.toBeInTheDocument();
  });

  it('uses polished action-row styling hooks for submit and cancel actions', () => {
    // Arrange: Render the tariff form.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Inspect the rendered action controls.
    const saveButton = screen.getByRole('button', { name: /save tariff/i });
    const cancelButton = screen.getByText('Cancel').closest('button');

    // Assert: Buttons expose shared visual contract classes used by session workflows.
    expect(cancelButton).toBeTruthy();
    expect(saveButton.className).toContain('bg-accent');
    expect(saveButton.className).toContain('rounded-xl');
    expect(saveButton.className).toContain('min-h-[56px]');
    expect(cancelButton?.className).toContain('bg-secondary/10');
    expect(cancelButton?.className).toContain('rounded-xl');
    expect(cancelButton?.className).toContain('min-h-[56px]');
  });

  it('submits flattened charging-plan payload', async () => {
    // Arrange: Render and enter tariff inputs across grouped sections.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'Travel Tariff' } });
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,49' } });
    fireEvent.change(screen.getByLabelText(/^dc price$/i), { target: { value: '0,59' } });
    fireEvent.change(screen.getByLabelText(/roaming ac price/i), { target: { value: '0,69' } });
    fireEvent.change(screen.getByLabelText(/roaming dc price/i), { target: { value: '0,79' } });
    fireEvent.change(screen.getByLabelText(/monthly base fee/i), { target: { value: '3,99' } });
    fireEvent.change(screen.getByLabelText(/session fee/i), { target: { value: '0,99' } });
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Form maps browser strings to flat charging-plan payload.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'create',
        plan: expect.objectContaining({
          name: 'Travel Tariff',
          provider_id: 'p1',
          ac_price_per_kwh: 49,
          dc_price_per_kwh: 59,
          roaming_ac_price_per_kwh: 69,
          roaming_dc_price_per_kwh: 79,
          monthly_base_fee: 399,
          session_fee: 99,
        }),
      })
    );
  });

  it('keeps optional prices undefined and falls back required fees to zero', async () => {
    // Arrange: Fill only the required provider field and leave price inputs blank.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });

    // Act: Submit the form without optional money values.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Optional price fields remain undefined while fee fields are explicit zeroes.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'create',
        plan: expect.objectContaining({
          ac_price_per_kwh: undefined,
          dc_price_per_kwh: undefined,
          roaming_ac_price_per_kwh: undefined,
          roaming_dc_price_per_kwh: undefined,
          monthly_base_fee: 0,
          session_fee: 0,
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

    // Assert: Submission succeeds and persists empty name.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'create',
        plan: expect.objectContaining({
          name: '',
          provider_id: 'p1',
        }),
      })
    );
  });

  it('coerces persisted date strings into displayed picker values', () => {
    // Arrange: Provide initialValues with string dates as they might be rehydrated from storage.
    render(
      <TariffForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialValues={{ valid_from: '2026-05-31T00:00:00.000Z', valid_to: '2026-06-30T00:00:00.000Z' } as any}
      />
    );

    // Act: Inspect the normalized date picker triggers.

    // Assert: Date pickers show normalized UTC calendar values.
    expect(screen.getByLabelText(/valid from/i)).toHaveTextContent('31.05.2026');
    expect(screen.getByLabelText(/valid to/i)).toHaveTextContent('30.06.2026');
  });

  it('shows open-ended for an empty optional valid-to date and submits null', async () => {
    // Arrange: Render a tariff with no end date.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={{ provider_id: 'p1' }} />);

    // Act: Inspect, open, cancel, and submit.
    const validTo = screen.getByLabelText(/valid to/i);
    fireEvent.click(validTo);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Opening the picker does not commit today and persistence remains open-ended.
    expect(validTo).toHaveTextContent('Open-ended');
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          valid_to: null,
        }),
      })
    );
  });

  it('sets and clears optional valid-to with the shared picker', async () => {
    // Arrange: Render a tariff form and set required provider.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });

    // Act: Choose and then clear Valid To.
    pickDate(/valid to/i, '2026-06-30');
    expect(screen.getByLabelText(/valid to/i)).toHaveTextContent('30.06.2026');
    fireEvent.click(screen.getByLabelText(/valid to/i));
    fireEvent.click(screen.getByRole('button', { name: /no end date/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Clearing returns the submitted plan to the existing open-ended contract.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/valid to/i)).toHaveTextContent('Open-ended');
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          valid_to: null,
        }),
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
        intent: 'create',
        plan: expect.objectContaining({
          name: '',
        }),
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

  it('shows specific overlapping-tariff-version error from service', async () => {
    // Arrange: Service rejects an overlapping version for same provider and name.
    mockOnSubmit.mockRejectedValueOnce(new Error('Tariff validity overlaps with an existing active version for this provider and name'));
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'mobility+ m' } });
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,49' } });

    // Act: Submit and surface service error.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Conflict message is shown to the user.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tariff validity overlaps with an existing active version for this provider and name');
  });

  it('rejects malformed money input before submit and shows a validation error', async () => {
    // Arrange: Enter required fields plus a malformed decimal amount.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,4,9' } });

    // Act: Submit the form with invalid money input.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Submission is blocked and the user sees the validation message.
    await screen.findByText('Enter a valid non-negative amount');
    expect(mockOnSubmit).not.toHaveBeenCalled();
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
          name: 'UTC Tariff',
          provider_id: 'p1',
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
          valid_to: new Date('2026-01-31T00:00:00.000Z'),
        }}
      />
    );

    // Act: Inspect the rendered edit-mode date fields.

    // Assert: Date pickers preserve UTC calendar date.
    expect(screen.getByLabelText(/valid from/i)).toHaveTextContent('01.01.2026');
    expect(screen.getByLabelText(/valid to/i)).toHaveTextContent('31.01.2026');
  });

  it('locks provider and keeps tariff name editable in edit mode', () => {
    // Arrange: Render mode="edit" with provider_id "p1" and name "Lidl".
    render(
      <TariffForm
        mode="edit"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{
          id: 'plan-1',
          provider_id: 'p1',
          name: 'Lidl',
        }}
      />
    );

    // Act: Inspect editability of the identity controls.

    // Assert: Provider is disabled and Tariff Name is enabled.
    expect(screen.getByLabelText(/^provider$/i)).toBeDisabled();
    expect(screen.getByLabelText(/tariff name/i)).not.toBeDisabled();
  });

  it('submits update_current when valid from is unchanged', async () => {
    // Arrange: initial valid_from is 2026-01-01.
    render(
      <TariffForm
        mode="edit"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{
          id: 'plan-1',
          provider_id: 'p1',
          name: 'Lidl',
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
        }}
      />
    );
    fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'Lidl Corrected' } });

    // Act: change name only and save.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: onSubmit receives intent "update_current".
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'update_current',
        logicalIdentity: {
          providerId: 'p1',
          name: 'Lidl',
        },
        originalValidFrom: new Date('2026-01-01T00:00:00.000Z'),
      })
    );
  });

  it('submits create_successor when valid from changes', async () => {
    // Arrange: initial valid_from is 2026-01-01.
    render(
      <TariffForm
        mode="edit"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{
          id: 'plan-1',
          provider_id: 'p1',
          name: 'Lidl',
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
        }}
      />
    );
    pickDate(/valid from/i, '2026-08-15');

    // Act: change Valid From to 2026-08-15 and save.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: onSubmit receives intent "create_successor".
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'create_successor',
        logicalIdentity: {
          providerId: 'p1',
          name: 'Lidl',
        },
        originalValidFrom: new Date('2026-01-01T00:00:00.000Z'),
      })
    );
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
    const initialValues = { name: 'Workday' };

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
