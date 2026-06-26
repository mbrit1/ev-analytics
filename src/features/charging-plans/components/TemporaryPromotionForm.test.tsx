import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporaryPromotionForm } from './TemporaryPromotionForm';
import type { ChargingPlan } from '../../../infra/db';

const buildVersion = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: overrides.id ?? 'plan-1',
  user_id: overrides.user_id ?? 'user-1',
  provider_id: overrides.provider_id ?? 'provider-1',
  name: overrides.name ?? 'Road Flex',
  valid_from: overrides.valid_from ?? new Date('2026-01-01T00:00:00.000Z'),
  valid_to: overrides.valid_to ?? null,
  ac_price_per_kwh: overrides.ac_price_per_kwh,
  dc_price_per_kwh: overrides.dc_price_per_kwh,
  roaming_ac_price_per_kwh: overrides.roaming_ac_price_per_kwh,
  roaming_dc_price_per_kwh: overrides.roaming_dc_price_per_kwh,
  monthly_base_fee: overrides.monthly_base_fee ?? 0,
  session_fee: overrides.session_fee ?? 0,
  affiliation: overrides.affiliation,
  notes: overrides.notes,
  created_at: overrides.created_at ?? new Date('2026-01-01T00:00:00.000Z'),
  updated_at: overrides.updated_at ?? new Date('2026-01-01T00:00:00.000Z'),
  deleted_at: overrides.deleted_at,
});

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
  fireEvent.click(screen.getByRole('button', { name: /set date/i }));
}

/**
 * Test suite for the temporary promotion form's field rendering, date validation,
 * money parsing, baseline prefilling, and rejection handling.
 */
describe('TemporaryPromotionForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();
  const versions: ChargingPlan[] = [
    buildVersion({
      id: 'baseline-1',
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      valid_to: new Date('2026-03-01T00:00:00.000Z'),
      ac_price_per_kwh: 49,
      dc_price_per_kwh: 59,
      roaming_ac_price_per_kwh: 69,
      roaming_dc_price_per_kwh: 79,
      monthly_base_fee: 399,
      session_fee: 99,
    }),
    buildVersion({
      id: 'baseline-2',
      valid_from: new Date('2026-03-01T00:00:00.000Z'),
      valid_to: new Date('2026-07-01T00:00:00.000Z'),
      ac_price_per_kwh: 55,
      dc_price_per_kwh: 65,
      roaming_ac_price_per_kwh: 75,
      roaming_dc_price_per_kwh: 85,
      monthly_base_fee: 499,
      session_fee: 149,
    }),
    buildVersion({
      id: 'baseline-3',
      valid_from: new Date('2026-07-01T00:00:00.000Z'),
      ac_price_per_kwh: 199,
      dc_price_per_kwh: 299,
      roaming_ac_price_per_kwh: 399,
      roaming_dc_price_per_kwh: 499,
      monthly_base_fee: 100000,
      session_fee: 2500,
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both dates and all six price and fee fields', () => {
    // Arrange: Render the temporary promotion form.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Inspect the rendered promotion surface.

    // Assert: The promotion workflow exposes its full date and price surface.
    expect(screen.getByLabelText(/promo start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/promo end/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^ac price$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^dc price$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/roaming ac price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/roaming dc price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/monthly base fee/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/session fee/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/promo start/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/promo end/i)).toHaveAttribute('aria-required', 'true');
  });

  it('converts comma decimals to integer cents on submit', async () => {
    // Arrange: Select a promo window and override each monetary field.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-05');
    pickDate(/promo end/i, '2026-03-07');
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,41' } });
    fireEvent.change(screen.getByLabelText(/^dc price$/i), { target: { value: '0,51' } });
    fireEvent.change(screen.getByLabelText(/roaming ac price/i), { target: { value: '0,61' } });
    fireEvent.change(screen.getByLabelText(/roaming dc price/i), { target: { value: '0,71' } });
    fireEvent.change(screen.getByLabelText(/monthly base fee/i), { target: { value: '2,99' } });
    fireEvent.change(screen.getByLabelText(/session fee/i), { target: { value: '0,79' } });

    // Act: Submit the promotion.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: Payload uses UTC dates and integer cents.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(mockOnSubmit).toHaveBeenCalledWith({
      promoStart: new Date('2026-03-05T00:00:00.000Z'),
      promoEndInclusive: new Date('2026-03-07T00:00:00.000Z'),
      prices: {
        ac_price_per_kwh: 41,
        dc_price_per_kwh: 51,
        roaming_ac_price_per_kwh: 61,
        roaming_dc_price_per_kwh: 71,
        monthly_base_fee: 299,
        session_fee: 79,
      },
    });
  });

  it('prefills prices from the resolved baseline after selecting a promo start date', async () => {
    // Arrange: Render the promotion form with multiple baselines.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Select a promo start date covered by the second baseline.
    pickDate(/promo start/i, '2026-03-05');

    // Assert: Monetary inputs are prefilled from the resolved baseline.
    await waitFor(() => expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,55'));
    expect(screen.getByLabelText(/^dc price$/i)).toHaveValue('0,65');
    expect(screen.getByLabelText(/roaming ac price/i)).toHaveValue('0,75');
    expect(screen.getByLabelText(/roaming dc price/i)).toHaveValue('0,85');
    expect(screen.getByLabelText(/monthly base fee/i)).toHaveValue('4,99');
    expect(screen.getByLabelText(/session fee/i)).toHaveValue('1,49');
  });

  it('switching promo start to a different baseline updates the prefills', async () => {
    // Arrange: Resolve one baseline first so the next change exercises the switch path.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    // Act: Change from the first baseline to a later grouped-currency baseline.
    pickDate(/promo start/i, '2026-02-15');
    await waitFor(() => expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,49'));
    pickDate(/promo start/i, '2026-07-05');

    // Assert: Prefills reflect the newly resolved baseline.
    await waitFor(() => expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('1,99'));
    expect(screen.getByLabelText(/^dc price$/i)).toHaveValue('2,99');
    expect(screen.getByLabelText(/roaming ac price/i)).toHaveValue('3,99');
    expect(screen.getByLabelText(/roaming dc price/i)).toHaveValue('4,99');
    expect(screen.getByLabelText(/monthly base fee/i)).toHaveValue('1.000,00');
    expect(screen.getByLabelText(/session fee/i)).toHaveValue('25,00');
  });

  it('does not overwrite an edited prefill when validation reruns within the same baseline', async () => {
    // Arrange: Resolve a baseline and customize a prefilled value.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-05');
    pickDate(/promo end/i, '2026-03-07');
    await waitFor(() => expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,55'));
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,77' } });

    // Act: Trigger validation without changing the resolved baseline.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: The edited value remains intact after validation.
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,77');
  });

  it('shows a date-field error and disables submit when no baseline exists', async () => {
    // Arrange: Render the promotion form with no baseline covering the selected start date.
    const gapVersions = [
      buildVersion({
        id: 'gap-before',
        valid_from: new Date('2026-01-01T00:00:00.000Z'),
        valid_to: new Date('2026-03-01T00:00:00.000Z'),
      }),
      buildVersion({
        id: 'gap-after',
        valid_from: new Date('2026-03-10T00:00:00.000Z'),
        valid_to: null,
      }),
    ];
    render(<TemporaryPromotionForm versions={gapVersions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    const submitButton = screen.getByRole('button', { name: /save promotion/i });

    // Act: Pick a promo start date after the earliest version starts but outside any baseline window.
    pickDate(/promo start/i, '2026-03-05');

    // Assert: The date field surfaces the missing-baseline error and submit becomes disabled.
    expect(await screen.findByText('No baseline tariff exists for 2026-03-05')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows a field error and disables submit when promo start equals the baseline start', async () => {
    // Arrange: Render the promotion form and target the exact start date of an existing baseline.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    const submitButton = screen.getByRole('button', { name: /save promotion/i });

    // Act: Select the first day of the second baseline.
    pickDate(/promo start/i, '2026-03-01');

    // Assert: The form blocks the same-day boundary with a field-level message.
    expect(await screen.findByText('Choose a promo start after the current tariff starts')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('requires at least one price or positive fee before submit', async () => {
    // Arrange: Resolve a baseline and clear every price and fee value.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-05');
    pickDate(/promo end/i, '2026-03-07');
    await waitFor(() => expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,55'));
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^dc price$/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/roaming ac price/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/roaming dc price/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/monthly base fee/i), { target: { value: '0,00' } });
    fireEvent.change(screen.getByLabelText(/session fee/i), { target: { value: '0,00' } });

    // Act: Submit with no meaningful pricing left.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: The form blocks submit and surfaces the shared pricing requirement.
    expect(await screen.findByText('Enter at least one price or positive fee')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('keeps invalid money in the form and shows validation', async () => {
    // Arrange: Select a valid promo window and enter an invalid negative fee.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-05');
    pickDate(/promo end/i, '2026-03-07');
    fireEvent.change(screen.getByLabelText(/session fee/i), { target: { value: '-0,79' } });

    // Act: Attempt to submit invalid money.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: Validation blocks submission and preserves entered text.
    expect(await screen.findByText('Enter a valid non-negative amount')).toBeInTheDocument();
    expect(screen.getByLabelText(/session fee/i)).toHaveValue('-0,79');
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('keeps malformed money in the form and shows validation', async () => {
    // Arrange: Select a valid promo window and enter a malformed roaming price.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-05');
    pickDate(/promo end/i, '2026-03-07');
    fireEvent.change(screen.getByLabelText(/roaming ac price/i), { target: { value: '0,6,1' } });

    // Act: Attempt to submit malformed money.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: Validation blocks submission and preserves the malformed text.
    expect(await screen.findByText('Enter a valid non-negative amount')).toBeInTheDocument();
    expect(screen.getByLabelText(/roaming ac price/i)).toHaveValue('0,6,1');
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows a field error when promotion end is before start', async () => {
    // Arrange: Enter an inverted promotion window.
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-07');
    pickDate(/promo end/i, '2026-03-05');

    // Act: Try to submit the invalid date range.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: The end-date field shows the cross-field validation error.
    expect(await screen.findByText('Promo end must be on or after promo start')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows service rejection as a root alert without clearing entered values', async () => {
    // Arrange: Fill a valid promotion and make the service reject it.
    mockOnSubmit.mockRejectedValueOnce(new Error('Cannot schedule promotion because version starting 2026-03-06 already exists'));
    render(<TemporaryPromotionForm versions={versions} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    pickDate(/promo start/i, '2026-03-05');
    pickDate(/promo end/i, '2026-03-07');
    fireEvent.change(screen.getByLabelText(/^ac price$/i), { target: { value: '0,41' } });
    fireEvent.change(screen.getByLabelText(/monthly base fee/i), { target: { value: '2,99' } });

    // Act: Submit and let the service reject.
    fireEvent.click(screen.getByRole('button', { name: /save promotion/i }));

    // Assert: The rejection is surfaced and form values remain in place.
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot schedule promotion because version starting 2026-03-06 already exists');
    expect(screen.getByLabelText(/promo start/i)).toHaveTextContent('05.03.2026');
    expect(screen.getByLabelText(/promo end/i)).toHaveTextContent('07.03.2026');
    expect(screen.getByLabelText(/^ac price$/i)).toHaveValue('0,41');
    expect(screen.getByLabelText(/monthly base fee/i)).toHaveValue('2,99');
  });
});
