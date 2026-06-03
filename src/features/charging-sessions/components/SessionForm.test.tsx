import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionForm } from './SessionForm';
import { getActivePlanSelectionAt, setActivePlanSelection, useChargingPlans, useProviders } from '../../charging-plans';
import { type ChargingPlan, type Provider } from '../../../infra/db';

// Mock dependent hooks so form tests can exercise validation and submission UI
// without requiring tariff/provider IndexedDB state.
vi.mock('../../charging-plans');
vi.mock('../../auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null, signIn: vi.fn(), signOut: vi.fn() })
}));

/**
 * Test suite for the charging-session form.
 *
 * Verifies required field rendering and mobile-friendly numeric input modes
 * while provider, tariff, and auth hooks are mocked.
 */
describe('SessionForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();
  const getLabelByTextContent = (labelText: string) =>
    screen.getByText((_, element) => element?.tagName === 'LABEL' && element.textContent?.replace(/\s+/g, ' ').trim() === labelText);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          name: 'P1 Home',
          provider_id: 'p1',
          ac_price_per_kwh: 40,
          dc_price_per_kwh: 60,
          roaming_ac_price_per_kwh: 50,
          roaming_dc_price_per_kwh: 70,
          monthly_base_fee: 0,
          session_fee: 0
        },
        {
          id: 't2',
          name: 'P1 Flex',
          provider_id: 'p1',
          ac_price_per_kwh: 44,
          dc_price_per_kwh: 64,
          roaming_ac_price_per_kwh: 54,
          roaming_dc_price_per_kwh: 74,
          monthly_base_fee: 0,
          session_fee: 0
        },
        {
          id: 't3',
          name: 'P2 Solo',
          provider_id: 'p2',
          ac_price_per_kwh: 39,
          dc_price_per_kwh: 59,
          roaming_ac_price_per_kwh: 49,
          roaming_dc_price_per_kwh: 69,
          monthly_base_fee: 0,
          session_fee: 0
        }
      ] as unknown as ChargingPlan[],
      isLoading: false,
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
    });
    vi.mocked(useProviders).mockReturnValue({
      providers: [
        { id: 'p1', name: 'ChargePoint' },
        { id: 'p2', name: 'Ionity' },
        { id: 'p3', name: 'NoPlan Energy' }
      ] as unknown as Provider[],
      isLoading: false
    });
    vi.mocked(getActivePlanSelectionAt).mockResolvedValue(null);
    vi.mocked(setActivePlanSelection).mockImplementation(async (input) => ({
      id: 'ps-test',
      user_id: input.userId,
      provider_id: input.providerId,
      tariff_plan_id: input.tariffPlanId,
      valid_from: input.validFrom,
      valid_to: null,
      price_snapshot: input.priceSnapshot,
      created_at: new Date('2026-05-28T00:00:00.000Z'),
      updated_at: new Date('2026-05-28T00:00:00.000Z'),
    }));
  });

  it('renders correctly with required fields', () => {
    // Arrange: Render the form with mocked providers, tariffs, and auth state.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    // Assert: Core data-entry controls are present.
    expect(screen.getByLabelText(/date/i)).toBeDefined();
    expect(screen.getByLabelText(/provider/i)).toBeDefined();
    expect(screen.getByText(/pricing source/i)).toBeDefined();
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toBeDefined();
    expect(screen.queryByText(/charging rate/i)).toBeNull();
    expect(screen.getByLabelText(/kwh billed/i)).toBeDefined();
    expect(screen.getByText(/required fields/i)).toBeDefined();
  });

  it('shows charging-plan provider/plan and combined charging-rate controls by default', () => {
    // Arrange: Render a fresh session form.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Charging plan mode controls are visible.
    expect(screen.getByRole('radio', { name: /charging plan/i })).toBeDefined();
    expect(screen.getByRole('radio', { name: /ad-hoc/i })).toBeDefined();
    expect(screen.getByLabelText(/provider/i)).toBeDefined();
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toBeDefined();
    expect(screen.queryByText(/charging rate/i)).toBeNull();
    expect(screen.queryByText(/^pricing mode$/i)).toBeNull();
    expect(screen.queryByText(/^charging type$/i)).toBeNull();
  });

  it('switches to ad-hoc pricing fields when pricing source is ad-hoc', () => {
    // Arrange: Render form in default charging-plan mode.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: Select ad-hoc as pricing source.
    fireEvent.click(screen.getByRole('radio', { name: /ad-hoc/i }));

    // Assert: Provider and plan selectors are hidden and ad-hoc fields appear.
    expect(screen.getByLabelText(/provider/i)).toBeDefined();
    expect(screen.queryByLabelText(/^plan\s*\*?$/i)).toBeNull();
    expect(screen.getByLabelText(/cpo\/operator/i)).toBeDefined();
    expect(screen.getByLabelText(/price per kwh/i)).toBeDefined();
    expect(screen.getByLabelText(/session fee/i)).toBeDefined();
    expect(screen.getByLabelText(/receipt url/i)).toBeDefined();
    expect(screen.getByLabelText(/other fees/i)).toBeDefined();
    expect(screen.queryByText(/charging rate/i)).toBeNull();
  });

  it('shows required markers for default charging-plan required fields', () => {
    // Arrange: Render form in charging-plan mode.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Required labels include textual marker.
    expect(getLabelByTextContent('Date *')).toBeDefined();
    expect(getLabelByTextContent('Provider *')).toBeDefined();
    expect(getLabelByTextContent('Plan *')).toBeDefined();
    expect(getLabelByTextContent('kWh Billed *')).toBeDefined();
  });

  it('updates required markers when switching to ad-hoc pricing', () => {
    // Arrange: Render form and switch to ad-hoc mode.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('radio', { name: /ad-hoc/i }));

    // Assert: Conditional required labels are shown for ad-hoc fields.
    expect(getLabelByTextContent('Date *')).toBeDefined();
    expect(getLabelByTextContent('CPO/Operator *')).toBeDefined();
    expect(getLabelByTextContent('Price per kWh *')).toBeDefined();
    expect(getLabelByTextContent('kWh Billed *')).toBeDefined();
    expect(screen.getByLabelText(/provider/i)).toBeDefined();
    expect(screen.queryByLabelText(/^plan\s*\*?$/i)).toBeNull();
  });

  it('sets required and aria-required attributes on native required inputs/selects', () => {
    // Arrange: Render in default charging-plan mode.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Assert: Native required controls are explicitly marked.
    expect(screen.getByLabelText(/date/i)).toHaveAttribute('required');
    expect(screen.getByLabelText(/date/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/provider/i)).toHaveAttribute('required');
    expect(screen.getByLabelText(/provider/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toHaveAttribute('required');
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/kwh billed/i)).toHaveAttribute('required');
    expect(screen.getByLabelText(/kwh billed/i)).toHaveAttribute('aria-required', 'true');
  });

  it('uses numeric/decimal input modes for mobile optimization', () => {
    // Arrange: Render the form with default values.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    
    // Assert: Decimal and numeric fields request the correct mobile keyboards.
    const kwhInput = screen.getByLabelText(/kwh billed/i);
    expect(kwhInput).toHaveAttribute('inputMode', 'decimal');
    
    const startSocInput = screen.getByLabelText(/start soc/i);
    expect(startSocInput).toHaveAttribute('inputMode', 'numeric');
    expect(startSocInput).toHaveAttribute('placeholder', '20');
  });

  it('submits correctly with initial values', async () => {
    // Arrange: Seed edit-mode initial values for a complete session.
    const initialValues = {
      session_timestamp: new Date('2024-05-15'),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      kwh_billed: 25.5,
      start_soc_percentage: undefined,
      end_soc_percentage: undefined,
      charging_type: 'AC' as const,
      pricing_context: 'standard' as const,
    };
    
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);
    
    // Act: Submit the form without changing initial values.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));
    
    // Assert: The prepared session should be passed to the submit callback.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
  });

  it('prefills plan selector from legacy tariff_id when tariff_plan_id is absent', () => {
    // Arrange: legacy session shape where only tariff_id exists.
    const initialValues = {
      session_timestamp: new Date('2024-05-15'),
      provider_id: 'p1',
      tariff_id: 't1',
      kwh_billed: 25.5,
      charging_type: 'AC' as const,
      pricing_context: 'roaming' as const,
    } as unknown as Partial<import('../../../infra/db').ChargingSession>;

    // Act: Render edit form with legacy initial values.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);

    // Assert: Legacy tariff id is applied to the plan select control.
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toHaveValue('t1');
  });

  it('reopens persisted roaming sessions with roaming pricing context', async () => {
    // Arrange: existing session preserves roaming mode.
    const initialValues = {
      session_timestamp: new Date('2024-05-15'),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      kwh_billed: 25.5,
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
      pricing_context: 'roaming' as const,
    } as unknown as Partial<import('../../../infra/db').ChargingSession>;

    // Act: Render and submit unchanged edit values.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);
    expect(screen.getByRole('radio', { name: /roaming ac\s+0,50 €\/kwh/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: Stored roaming context is preserved through re-save.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ pricing_context: 'roaming', session_mode: 'plan' })
      );
    });
  });

  it('opens in ad-hoc mode and clears stale tariff_plan_id from legacy initial values', async () => {
    // Arrange: newer payload without compatibility field should map mode on load.
    const initialValues = {
      session_timestamp: new Date('2024-05-15'),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      kwh_billed: 25.5,
      charging_type: 'AC' as const,
      session_mode: 'ad_hoc' as const,
      ad_hoc_pricing: {
        cpoName: 'FastNet',
        pricePerKwh: 59
      },
    } as unknown as Partial<import('../../../infra/db').ChargingSession>;

    // Act: Render with ad-hoc initial values.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);
    // Assert: ad-hoc fields are visible.
    expect(screen.getByLabelText(/cpo\/operator/i)).toBeDefined();
    expect(screen.getByLabelText(/provider/i)).toBeDefined();
    expect(screen.queryByLabelText(/^plan\s*\*?$/i)).toBeNull();

    // Act: submit without touching pricing source fields.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: stale plan id is normalized away for ad-hoc submissions.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          session_mode: 'ad_hoc',
          tariff_plan_id: null
        })
      );
    });
  });

  it('submits with optional SoC left empty', async () => {
    // Arrange: Render form with required provider/tariff defaults.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10,0' } });
    fireEvent.change(screen.getByLabelText(/start soc/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/end soc/i), { target: { value: '' } });

    // Act: Submit with blank SoC values.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: Blank SoC is accepted and submission proceeds.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
  });

  it('submits ad-hoc sessions with ad_hoc_pricing snapshot and session_mode', async () => {
    // Arrange: Fill required session fields in ad-hoc mode.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('radio', { name: /ad-hoc/i }));
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10,5' } });
    fireEvent.change(screen.getByLabelText(/cpo\/operator/i), { target: { value: 'FastNet' } });
    fireEvent.change(screen.getByLabelText(/price per kwh/i), { target: { value: '0,59' } });
    fireEvent.change(screen.getByLabelText(/session fee/i), { target: { value: '1,50' } });
    fireEvent.change(screen.getByLabelText(/receipt url/i), { target: { value: 'https://example.com/receipt' } });
    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: 'Night charge' } });
    fireEvent.change(screen.getByLabelText(/other fees/i), { target: { value: '2,00' } });

    // Act: Submit.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: Submission uses ad_hoc source and includes ad_hoc_pricing snapshot.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          session_mode: 'ad_hoc',
          provider_id: 'p1',
          tariff_plan_id: null,
          ad_hoc_pricing: expect.objectContaining({
            cpoName: 'FastNet',
            pricePerKwh: 59,
            pricePerSession: 150,
            receiptUrl: 'https://example.com/receipt',
            notes: 'Night charge',
            otherFees: expect.any(Array),
          }),
        })
      );
    });
  });

  it('disables plan select until a provider is selected', () => {
    // Arrange: render with no selected provider.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: inspect plan control before and after provider selection.
    const planSelect = screen.getByLabelText(/^plan\s*\*?$/i);

    // Assert: plan is disabled until provider is selected.
    expect(planSelect).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    expect(planSelect).not.toBeDisabled();
  });

  it('shows only plans belonging to the selected provider', () => {
    // Arrange: render and choose provider p1.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });

    // Act: read displayed plan option labels.
    const optionLabels = Array.from(screen.getByLabelText(/^plan\s*\*?$/i).querySelectorAll('option'))
      .map(option => option.textContent);

    // Assert: p1 plans are shown and p2 plans are hidden.
    expect(optionLabels).toContain('P1 Home');
    expect(optionLabels).toContain('P1 Flex');
    expect(optionLabels).not.toContain('P2 Solo');
  });

  it('auto-selects the plan when selected provider has exactly one plan', () => {
    // Arrange: render a fresh form.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: choose provider p2, which has a single available plan.
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p2' } });

    // Assert: the single matching plan is selected automatically.
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toHaveValue('t3');
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toBeDisabled();
  });

  it('shows charging-rate choices only after a plan is selected', () => {
    // Arrange: render a fresh form and choose a provider with multiple plans.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });

    // Assert: plan-dependent rate choices are not rendered while plan selection is empty.
    expect(screen.queryByText(/charging rate/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: /domestic ac/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /roaming ac/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /domestic dc/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /roaming dc/i })).toBeNull();

    // Act: choose a plan.
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });

    // Assert: once a plan is selected, supported rate choices become available with prices.
    expect(screen.getByRole('radio', { name: /domestic ac\s+0,40 €\/kwh/i })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /roaming ac\s+0,50 €\/kwh/i })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /domestic dc\s+0,60 €\/kwh/i })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /roaming dc\s+0,70 €\/kwh/i })).not.toBeDisabled();
  });

  it('keeps the plan select enabled when the selected provider has multiple plans', () => {
    // Arrange: render a fresh form.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Act: choose provider p1, which has multiple plans in the fixture set.
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });

    // Assert: the plan select remains interactive because the user must choose.
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).not.toBeDisabled();
  });

  it('clears stale plan when provider changes to one that does not own it', () => {
    // Arrange: choose provider p1 and its plan first.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });

    // Act: switch provider to p2.
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p2' } });

    // Assert: stale selection is replaced with the only valid p2 plan.
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toHaveValue('t3');
  });

  it('shows validation feedback when ad-hoc price per kwh format is invalid', async () => {
    // Arrange: Switch to ad-hoc mode and enter invalid price text.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('radio', { name: /ad-hoc/i }));
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10,5' } });
    fireEvent.change(screen.getByLabelText(/cpo\/operator/i), { target: { value: 'Ionity' } });
    fireEvent.change(screen.getByLabelText(/price per kwh/i), { target: { value: 'abc' } });

    // Act: Submit with invalid ad-hoc price per kWh format.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: User sees a field error and submit callback is not invoked.
    await waitFor(() => {
      expect(screen.getByText(/invalid price format/i)).toBeDefined();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('disables plan select when selected provider has no plans', () => {
    // Arrange: render form and select a provider without plans.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p3' } });

    // Assert: plan select is disabled because there are no options to choose.
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toBeDisabled();
  });

  it('shows plan required validation when charging-plan mode has no selected plan', async () => {
    // Arrange: pick provider with multiple plans but do not select one.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10,5' } });

    // Act: submit while plan remains empty.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: field-level validation blocks submit and explains missing plan.
    await waitFor(() => {
      expect(screen.getByText(/plan is required/i)).toBeDefined();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation feedback when kwh billed is zero', async () => {
    // Arrange: pick provider+plan and set invalid zero billed kWh.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '0' } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/must be greater than 0/i)).toBeDefined();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation feedback when kwh added is negative', async () => {
    // Arrange: pick provider+plan and set invalid negative added kWh.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/kwh added/i), { target: { value: '-1' } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/invalid kwh format/i)).toBeDefined();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation feedback when end SoC is below start SoC', async () => {
    // Arrange: pick provider+plan and set reversed SoC values.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/start soc/i), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/end soc/i), { target: { value: '60' } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/end soc must be greater than or equal to start soc/i)).toBeDefined();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits the selected combined charging rate as charging type and pricing context', async () => {
    // Arrange: fill required plan-mode fields.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10,0' } });

    // Act: select roaming DC as the combined rate and submit.
    fireEvent.click(screen.getByRole('radio', { name: /roaming dc/i }));
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: the domain payload keeps the existing fields expected by services.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          charging_type: 'DC',
          pricing_context: 'roaming',
          applied_price_per_kwh: 70,
        })
      );
    });
  });

  it('renders only combined charging rates backed by tariff prices', () => {
    // Arrange: Render a plan that has domestic AC and roaming DC pricing only.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          name: 'P1 Home',
          provider_id: 'p1',
          ac_price_per_kwh: 40,
          dc_price_per_kwh: null,
          roaming_ac_price_per_kwh: null,
          roaming_dc_price_per_kwh: 70,
          monthly_base_fee: 0,
          session_fee: 0
        }
      ] as unknown as ChargingPlan[],
      isLoading: false,
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
    });

    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't1' } });

    // Assert: Only priced rates are rendered, in the approved label order.
    const rateOptions = screen.getAllByRole('radio', { name: /(domestic|roaming)/i });
    expect(rateOptions).toHaveLength(2);
    expect(rateOptions.map((option) => option.getAttribute('aria-label') ?? option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Domestic AC 0,40 €/kWh',
      'Roaming DC 0,70 €/kWh',
    ]);
    expect(screen.queryByRole('radio', { name: /roaming ac/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /domestic dc/i })).toBeNull();
  });

  it('auto-selects the only available charging rate', async () => {
    // Arrange: Render a plan that has domestic AC pricing only.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't2',
          name: 'P1 AC Only',
          provider_id: 'p1',
          ac_price_per_kwh: 42,
          dc_price_per_kwh: null,
          roaming_ac_price_per_kwh: null,
          roaming_dc_price_per_kwh: null,
          monthly_base_fee: 0,
          session_fee: 0
        }
      ] as unknown as ChargingPlan[],
      isLoading: false,
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
    });

    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(/^plan\s*\*?$/i), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '10' } });

    // Assert: the one available rate is visible and selected.
    const onlyRate = screen.getByRole('radio', { name: /domestic ac\s+0,42 €\/kwh/i });
    expect(onlyRate).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: /roaming ac/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /domestic dc/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /roaming dc/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          charging_type: 'AC',
          pricing_context: 'standard',
          applied_price_per_kwh: 42,
        })
      );
    });
  });
});
