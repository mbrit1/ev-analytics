import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffForm } from './TariffForm';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth';
import { DuplicateProviderNameError } from '../services/providerService';

// Mock hooks and provider persistence so form tests stay focused on rendered
// inputs instead of IndexedDB state.
vi.mock('../hooks/useProviders');
vi.mock('../../auth');

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

  it('coerces persisted date strings and displays the exclusive end as the preceding day', () => {
    // Arrange: Provide initialValues with string dates as they might be rehydrated from storage.
    render(
      <TariffForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialValues={{ valid_from: '2026-05-31T00:00:00.000Z', valid_to: '2026-07-01T00:00:00.000Z' } as any}
      />
    );

    // Act: Inspect the normalized date picker triggers.

    // Assert: Valid From preserves its UTC day and Valid To shows the last billable day.
    expect(screen.getByLabelText(/valid from/i)).toHaveTextContent('31.05.2026');
    expect(screen.getByLabelText(/valid to/i)).toHaveTextContent('30.06.2026');
  });

  it('submits a selected inclusive valid-to date as the following exclusive UTC day', async () => {
    // Arrange: Render a new tariff and choose the last billable day.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });
    pickDate(/valid to/i, '2026-06-30');

    // Act: Save the tariff.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Persistence receives the canonical exclusive UTC boundary.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'create',
        plan: expect.objectContaining({
          valid_to: new Date('2026-07-01T00:00:00.000Z'),
        }),
      })
    );
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

  it('renders the preceding UTC day for a stored exclusive end without timezone drift', () => {
    // Arrange: Use a UTC midnight date that can drift in local timezone formatting.
    render(
      <TariffForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{
          name: 'UTC Tariff',
          provider_id: 'p1',
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
          valid_to: new Date('2026-02-01T00:00:00.000Z'),
        }}
      />
    );

    // Act: Inspect the rendered edit-mode date fields.

    // Assert: Valid From preserves its day and Valid To shows the inclusive boundary.
    expect(screen.getByLabelText(/valid from/i)).toHaveTextContent('01.01.2026');
    expect(screen.getByLabelText(/valid to/i)).toHaveTextContent('31.01.2026');
  });

  it('defaults create mode to an existing provider and exposes Add new provider', () => {
    // Arrange: Render create mode with a hydrated provider list.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Inspect provider-mode controls.

    // Assert: Existing-provider selection is shown with an explicit add action.
    expect(screen.getByRole('combobox', { name: /^provider$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add new provider/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/new provider name/i)).not.toBeInTheDocument();
  });

  it('switches to new-provider mode and focuses the provider name input', () => {
    // Arrange: Render create mode with an existing provider.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Enter the staged-provider mode.
    fireEvent.click(screen.getByRole('button', { name: /add new provider/i }));

    // Assert: The new name input is present and receives focus.
    const nameInput = screen.getByLabelText(/new provider name/i);
    expect(nameInput).toBeInTheDocument();
    expect(document.activeElement).toBe(nameInput);
  });

  it('backs to the provider list while discarding only the staged name', () => {
    // Arrange: Preserve an unrelated tariff value while staging a provider name.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,49' } });
    fireEvent.click(screen.getByRole('button', { name: /add new provider/i }));
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: '  New CPO  ' } });

    // Act: Return to the existing-provider mode.
    fireEvent.click(screen.getByRole('button', { name: /back to provider list/i }));

    // Assert: Only the provider draft is discarded.
    expect(screen.getByRole('combobox', { name: /^provider$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/new provider name/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,49');
  });

  it('enters new-provider mode only after an empty provider load resolves', () => {
    // Arrange: Start with an unresolved provider query.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: true });
    const { rerender } = render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    expect(screen.queryByLabelText(/new provider name/i)).not.toBeInTheDocument();

    // Act: Resolve loading with no providers.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    rerender(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Empty results automatically enter the new-provider mode.
    expect(screen.getByLabelText(/new provider name/i)).toBeInTheDocument();
  });

  it('returns an untouched automatic empty state to existing mode when providers hydrate late', () => {
    // Arrange: Render an automatic empty state, then hydrate an existing provider.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    const { rerender } = render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    expect(screen.getByLabelText(/new provider name/i)).toBeInTheDocument();

    // Act: Providers arrive without user interaction.
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p2', name: 'EWE Go', user_id: 'user-1', created_at: new Date(), updated_at: new Date() }],
      isLoading: false,
    });
    rerender(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: The untouched automatic state returns to existing-provider mode.
    expect(screen.getByRole('combobox', { name: /^provider$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/new provider name/i)).not.toBeInTheDocument();
  });

  it('does not show Back to provider list for automatic empty-provider mode', () => {
    // Arrange: Resolve the provider list empty without an explicit mode choice.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Inspect automatic new-provider mode actions.

    // Assert: Automatic mode has no discard action until the user explicitly enters it.
    expect(screen.getByLabelText(/new provider name/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to provider list/i })).not.toBeInTheDocument();
  });

  it('restores the selected provider and unrelated tariff fields after explicit mode Back', () => {
    // Arrange: Select p1, edit a tariff value, then explicitly stage a provider.
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/^provider$/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,49' } });
    fireEvent.click(screen.getByRole('button', { name: /add new provider/i }));

    // Act: Discard only the staged provider mode.
    fireEvent.click(screen.getByRole('button', { name: /back to provider list/i }));

    // Assert: The previous provider selection and tariff input remain intact.
    expect(screen.getByRole('combobox', { name: /^provider$/i })).toHaveValue('p1');
    expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,49');
  });

  it('preserves an interacted-with provider draft when providers hydrate late', () => {
    // Arrange: Enter a draft while the provider list is empty.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    const { rerender } = render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: 'Draft CPO' } });

    // Act: Hydrate providers after the user interacted with the draft.
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p2', name: 'EWE Go', user_id: 'user-1', created_at: new Date(), updated_at: new Date() }],
      isLoading: false,
    });
    rerender(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Explicit user input remains staged and visible.
    expect(screen.getByLabelText(/new provider name/i)).toHaveValue('Draft CPO');
  });

  it('preserves an explicitly chosen new-provider mode across later provider-list changes', () => {
    // Arrange: Enter new-provider mode explicitly with an empty draft.
    const { rerender } = render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /add new provider/i }));
    expect(screen.getByLabelText(/new provider name/i)).toHaveValue('');

    // Act: Hydrate or change the provider list after the explicit mode choice.
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p2', name: 'EWE Go', user_id: 'user-1', created_at: new Date(), updated_at: new Date() }],
      isLoading: false,
    });
    rerender(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Explicit mode remains new-provider mode even with an empty name.
    expect(screen.getByLabelText(/new provider name/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^provider$/i })).not.toBeInTheDocument();
  });

  it('submits a trimmed staged provider and matching plan provider id', async () => {
    // Arrange: Stage a provider and provide the minimum tariff values.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: '  New CPO  ' } });

    // Act: Save the tariff with the staged provider.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Create-only stagedProvider identity is shared by provider and plan.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'create',
      stagedProvider: { id: expect.any(String), name: 'New CPO' },
      plan: expect.objectContaining({ provider_id: expect.any(String) }),
    }));
    const submission = mockOnSubmit.mock.calls[0][0] as { stagedProvider: { id: string }; plan: { provider_id: string } };
    expect(submission.plan.provider_id).toBe(submission.stagedProvider.id);
  });

  it('rejects a staged provider name longer than 120 Unicode code points before submit', async () => {
    // Arrange: Enter a provider name that exceeds the accepted storage contract.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: 'A'.repeat(121) } });

    // Act: Attempt to save the tariff with the oversized staged provider.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Form validation blocks the local creation request.
    expect(await screen.findByText(/provider name must be 120 characters or fewer/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('rejects a staged provider name containing a control character before submit', async () => {
    // Arrange: Enter a non-printable control character in the staged provider name.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: 'New\u0007 CPO' } });

    // Act: Attempt to save the tariff with the invalid staged provider.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Form validation blocks the local creation request.
    expect(await screen.findByText(/provider name cannot contain control characters/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('reuses the staged provider id across a generic rejection and retry', async () => {
    // Arrange: Reject the first staged-provider submission generically.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    mockOnSubmit.mockRejectedValueOnce(new Error('Temporary save failure')).mockResolvedValueOnce(undefined);
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: 'Stable CPO' } });

    // Act: Submit twice after the first attempt fails.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Both create payloads carry the same staged provider identity.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(2));
    const first = mockOnSubmit.mock.calls[0][0] as { stagedProvider: { id: string } };
    const second = mockOnSubmit.mock.calls[1][0] as { stagedProvider: { id: string } };
    expect(second.stagedProvider.id).toBe(first.stagedProvider.id);
  });

  it('keeps a generic same-name rejection as a root save error without recovery', async () => {
    // Arrange: A generic error is returned for a staged name matching a local provider.
    mockOnSubmit.mockRejectedValueOnce(new Error('Temporary save failure'));
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /add new provider/i }));
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: 'ChargePoint' } });

    // Act: Submit and inspect the generic failure state.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Generic failures stay in root submit handling and offer no duplicate recovery.
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary save failure');
    expect(screen.queryByRole('button', { name: /select chargepoint instead/i })).not.toBeInTheDocument();
  });

  it('requires a real provider selection after untouched automatic mode hydrates existing providers', async () => {
    // Arrange: Automatic empty mode later hydrates with an existing provider.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    const { rerender } = render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    vi.mocked(useProviders).mockReturnValue({
      providers: [{ id: 'p2', name: 'EWE Go', user_id: 'user-1', created_at: new Date(), updated_at: new Date() }],
      isLoading: false,
    });
    rerender(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Submit without selecting the now-visible provider.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: Native provider validation blocks submission; no hidden sentinel is accepted.
    await screen.findByText(/provider is required/i);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('offers duplicate-provider recovery that selects the existing provider and preserves tariff values', async () => {
    // Arrange: Reject a staged provider with the typed duplicate error.
    const existing = { id: 'p2', name: 'EWE Go', user_id: 'user-1', created_at: new Date(), updated_at: new Date() };
    vi.mocked(useProviders).mockReturnValue({ providers: [existing], isLoading: false });
    mockOnSubmit.mockRejectedValueOnce(new DuplicateProviderNameError(existing));
    render(<TariffForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /add new provider/i }));
    fireEvent.change(screen.getByLabelText(/new provider name/i), { target: { value: 'EWE Go' } });
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,49' } });

    // Act: Submit and choose the duplicate recovery action.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));
    const duplicateInput = await screen.findByLabelText(/new provider name/i);
    const duplicateError = screen.getByText(/provider name already exists/i);
    expect(duplicateInput).toHaveAttribute('aria-describedby', expect.stringContaining(duplicateError.id));
    const recovery = await screen.findByRole('button', { name: /select ewe go instead/i });
    fireEvent.click(recovery);

    // Assert: Existing mode and selection replace only the staged provider state.
    expect(screen.getByRole('combobox', { name: /^provider$/i })).toHaveValue('p2');
    expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,49');
  });

  it('locks provider selection in edit mode and exposes no add/new-provider action', () => {
    // Arrange: Render an existing tariff in edit mode.
    render(
      <TariffForm
        mode="edit"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{ id: 'plan-1', provider_id: 'p1', name: 'Lidl' }}
      />
    );

    // Act: Inspect provider controls.

    // Assert: Edit mode keeps the native select disabled and provider mode locked.
    expect(screen.getByRole('combobox', { name: /^provider$/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /add new provider/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/new provider name/i)).not.toBeInTheDocument();
  });

  it('blocks edit submission when provider_id is empty', async () => {
    // Arrange: Render a locked edit form without a provider selection.
    render(
      <TariffForm
        mode="edit"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={{ id: 'plan-empty-provider', provider_id: '', name: 'Draft', valid_from: new Date('2026-01-01T00:00:00.000Z') }}
      />
    );

    // Act: Attempt to save the invalid edit.
    fireEvent.click(screen.getByRole('button', { name: /save tariff/i }));

    // Assert: The existing provider requirement blocks persistence.
    expect(await screen.findByText(/provider is required/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
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
          valid_to: new Date('2026-02-01T00:00:00.000Z'),
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
        plan: expect.objectContaining({
          valid_to: new Date('2026-02-01T00:00:00.000Z'),
        }),
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
    pickDate(/valid to/i, '2026-12-31');

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
        plan: expect.objectContaining({
          valid_to: new Date('2027-01-01T00:00:00.000Z'),
        }),
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
