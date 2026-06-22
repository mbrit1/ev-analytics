import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TariffList } from './TariffList';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth';
import type { ChargingPlan } from '../../../infra/db';
import type { LogicalTariff } from '../model/logicalTariffs';

vi.mock('../hooks/useChargingPlans');
vi.mock('../hooks/useProviders');
vi.mock('../../auth');
vi.mock('./TariffFormLoader', () => ({
  TariffFormLoader: (props: unknown) => {
    const resolved = props as { mode?: string; initialValues?: { name?: string }; onCancel?: () => void };
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
      try {
        if (resolved.mode === 'details') {
          await (resolved as {
            onSubmit?: (values: {
              nextProviderId: string;
              nextName: string;
              affiliation?: string;
              notes?: string;
            }) => Promise<void>;
          }).onSubmit?.({
            nextProviderId: 'p2',
            nextName: 'Renamed Tariff',
            affiliation: 'Family',
            notes: 'Updated note',
          });
        } else {
          await (resolved as { onSubmit?: (plan: ChargingPlan) => Promise<void> }).onSubmit?.(buildPlan({
            id: 'created-plan',
            user_id: '',
            provider_id: 'p1',
            name: 'Created Tariff',
          }));
        }
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : 'Failed');
      }
    };

    return (
      <div>
        Tariff Form
        {resolved.mode ? `:${resolved.mode}` : ''}
        {resolved.initialValues?.name ? `:${resolved.initialValues.name}` : ''}
        {error && <div role="alert">{error}</div>}
        <button type="button" onClick={handleSubmit}>Submit</button>
        <button type="button" onClick={resolved.onCancel}>Cancel</button>
      </div>
    );
  },
}));
vi.mock('./PermanentPriceChangeForm', () => ({
  PermanentPriceChangeForm: (props: unknown) => {
    const resolved = props as {
      onCancel?: () => void;
      onSubmit?: (values: {
        effectiveFrom: Date;
        prices: {
          ac_price_per_kwh?: number;
          dc_price_per_kwh?: number;
          roaming_ac_price_per_kwh?: number;
          roaming_dc_price_per_kwh?: number;
          monthly_base_fee: number;
          session_fee: number;
        };
      }) => Promise<void>;
    };
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
      try {
        await resolved.onSubmit?.({
          effectiveFrom: utc('2026-08-15'),
          prices: {
            ac_price_per_kwh: 31,
            dc_price_per_kwh: 51,
            monthly_base_fee: 0,
            session_fee: 0,
          },
        });
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : 'Failed');
      }
    };

    return (
      <div>
        Permanent Price Change Form
        {error && <div role="alert">{error}</div>}
        <button type="button" onClick={handleSubmit}>Submit</button>
        <button type="button" onClick={resolved.onCancel}>Cancel</button>
      </div>
    );
  },
}));
vi.mock('./TemporaryPromotionForm', () => ({
  TemporaryPromotionForm: (props: unknown) => {
    const resolved = props as {
      onCancel?: () => void;
      onSubmit?: (values: {
        promoStart: Date;
        promoEndInclusive: Date;
        prices: {
          ac_price_per_kwh?: number;
          dc_price_per_kwh?: number;
          roaming_ac_price_per_kwh?: number;
          roaming_dc_price_per_kwh?: number;
          monthly_base_fee: number;
          session_fee: number;
        };
      }) => Promise<void>;
    };
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
      try {
        await resolved.onSubmit?.({
          promoStart: utc('2026-08-10'),
          promoEndInclusive: utc('2026-08-31'),
          prices: {
            ac_price_per_kwh: 19,
            dc_price_per_kwh: 39,
            monthly_base_fee: 0,
            session_fee: 0,
          },
        });
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : 'Failed');
      }
    };

    return (
      <div>
        Temporary Promotion Form
        {error && <div role="alert">{error}</div>}
        <button type="button" onClick={handleSubmit}>Submit</button>
        <button type="button" onClick={resolved.onCancel}>Cancel</button>
      </div>
    );
  },
}));

const utc = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const buildPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: overrides.id ?? 'plan-1',
  user_id: overrides.user_id ?? 'user-1',
  provider_id: overrides.provider_id ?? 'provider-1',
  name: overrides.name ?? 'Lidl',
  valid_from: overrides.valid_from ?? utc('2026-01-01'),
  valid_to: overrides.valid_to ?? null,
  ac_price_per_kwh: overrides.ac_price_per_kwh,
  dc_price_per_kwh: overrides.dc_price_per_kwh,
  roaming_ac_price_per_kwh: overrides.roaming_ac_price_per_kwh,
  roaming_dc_price_per_kwh: overrides.roaming_dc_price_per_kwh,
  monthly_base_fee: overrides.monthly_base_fee ?? 0,
  session_fee: overrides.session_fee ?? 0,
  affiliation: overrides.affiliation,
  notes: overrides.notes,
  created_at: overrides.created_at ?? utc('2026-01-01'),
  updated_at: overrides.updated_at ?? utc('2026-01-01'),
  deleted_at: overrides.deleted_at,
});

const buildLogicalTariff = (overrides: Partial<LogicalTariff> = {}): LogicalTariff => {
  const baseline = buildPlan({
    id: 'baseline',
    provider_id: 'p1',
    name: 'Lidl',
    valid_from: utc('2026-01-01'),
    valid_to: utc('2026-08-15'),
    ac_price_per_kwh: 29,
    dc_price_per_kwh: 49,
    monthly_base_fee: 0,
    session_fee: 0,
  });
  const successor = buildPlan({
    id: 'successor',
    provider_id: 'p1',
    name: 'Lidl',
    valid_from: utc('2026-08-15'),
    ac_price_per_kwh: 35,
    dc_price_per_kwh: 55,
    monthly_base_fee: 0,
    session_fee: 0,
  });

  return {
    key: overrides.key ?? 'p1::lidl',
    providerId: overrides.providerId ?? 'p1',
    name: overrides.name ?? 'Lidl',
    versions: overrides.versions ?? [baseline, successor],
    currentVersion: overrides.currentVersion ?? baseline,
    nextVersion: overrides.nextVersion ?? successor,
    badge: overrides.badge ?? {
      kind: 'upcoming_change',
      date: '2026-08-15',
      label: 'Upcoming change on 15 Aug',
    },
    upcomingVisibility: overrides.upcomingVisibility ?? {
      kind: 'indicator',
      effectiveDate: '2026-08-15',
      label: 'Update scheduled · 15 Aug 2026',
    },
    history: overrides.history ?? [
      {
        plan: baseline,
        labels: ['Current'],
        startDate: '2026-01-01',
        endDateInclusive: '2026-08-14',
      },
      {
        plan: successor,
        labels: ['Scheduled'],
        startDate: '2026-08-15',
        endDateInclusive: null,
      },
    ],
  };
};

type ChargingPlansHookValue = ReturnType<typeof useChargingPlans>;

const buildHookValue = (
  overrides: Partial<ChargingPlansHookValue> = {},
): ChargingPlansHookValue => {
  const logicalTariff = buildLogicalTariff();

  return {
    plans: overrides.plans ?? logicalTariff.versions,
    planVersions: overrides.planVersions ?? logicalTariff.versions,
    logicalTariffs: overrides.logicalTariffs ?? [logicalTariff],
    isLoading: overrides.isLoading ?? false,
    addChargingPlan: overrides.addChargingPlan ?? vi.fn(),
    removeChargingPlan: overrides.removeChargingPlan ?? vi.fn(),
    updateCurrentVersion: overrides.updateCurrentVersion ?? vi.fn(),
    createSuccessorVersion: overrides.createSuccessorVersion ?? vi.fn(),
    updateLogicalTariffDetails: overrides.updateLogicalTariffDetails ?? vi.fn(),
    schedulePermanentChange: overrides.schedulePermanentChange ?? vi.fn(),
    schedulePromotion: overrides.schedulePromotion ?? vi.fn(),
    deleteLogicalTariff: overrides.deleteLogicalTariff ?? vi.fn(),
  };
};

const renderTariffList = (
  props: Partial<{
    isCreatingTariff: boolean;
    onCreateTariffChange: (isCreatingTariff: boolean) => void;
    onFormOpenChange?: (isOpen: boolean) => void;
  }> = {},
) => render(
  <TariffList
    isCreatingTariff={props.isCreatingTariff ?? false}
    onCreateTariffChange={props.onCreateTariffChange ?? vi.fn()}
    onFormOpenChange={props.onFormOpenChange}
  />,
);

async function openMenuAndChoose(label: string): Promise<void> {
  const user = userEvent.setup();
  // Arrange: Open the tariff action menu from the rendered card.
  await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));

  // Act: Choose the requested action from the overflow menu.
  await user.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));

  // Assert: Caller-specific expectations run in the parent test.
}

async function openMenu(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
}

/**
 * Test suite for grouped logical-tariff overview cards and their version workflow surfaces.
 *
 * Verifies one-card grouping, reachable history, overflow actions, and confirmed deletion.
 */
describe('TariffList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProviders).mockReturnValue({
      providers: [
        {
          id: 'p1',
          name: 'Ionity',
          user_id: 'user-1',
          created_at: utc('2026-01-01'),
          updated_at: utc('2026-01-01'),
        },
      ],
      isLoading: false,
    });
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
      } as never,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it('renders one card for all versions and displays the current price', () => {
    // Arrange: Expose one logical tariff with current and upcoming versions.
    const baseline = buildPlan({
      id: 'baseline',
      provider_id: 'p1',
      name: 'Lidl',
      valid_from: utc('2026-01-01'),
      valid_to: utc('2026-08-15'),
      ac_price_per_kwh: 29,
      dc_price_per_kwh: 49,
    });
    const successor = buildPlan({
      id: 'successor',
      provider_id: 'p1',
      name: 'Lidl',
      valid_from: utc('2026-08-15'),
      ac_price_per_kwh: 39,
      dc_price_per_kwh: 59,
    });
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          versions: [baseline, successor],
          currentVersion: baseline,
          nextVersion: successor,
        }),
      ],
      plans: [baseline, successor],
    }));

    // Act: Render the grouped tariff list.
    renderTariffList();

    // Assert: The list shows one grouped card, the upcoming indicator, and the current price.
    expect(screen.getAllByRole('button', { name: /edit ionity lidl/i })).toHaveLength(1);
    expect(screen.getByText('Update scheduled · 15 Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('0,29 €')).toBeInTheDocument();
  });

  it('hides optional price rows that have no current value', () => {
    // Arrange: Render a logical tariff whose current version only has domestic prices.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          currentVersion: buildPlan({
            id: 'current',
            provider_id: 'p1',
            name: 'Lidl',
            valid_from: utc('2026-01-01'),
            valid_to: utc('2026-08-15'),
            ac_price_per_kwh: 29,
            dc_price_per_kwh: 49,
            roaming_ac_price_per_kwh: undefined,
            roaming_dc_price_per_kwh: undefined,
            monthly_base_fee: 0,
            session_fee: 0,
          }),
        }),
      ],
    }));

    // Act: Render the tariff cards.
    renderTariffList();

    // Assert: Only the domestic prices stay visible and optional empty rows are omitted.
    expect(screen.getByText('Domestic AC')).toBeInTheDocument();
    expect(screen.getByText('Domestic DC')).toBeInTheDocument();
    expect(screen.queryByText('Roaming AC')).not.toBeInTheDocument();
    expect(screen.queryByText('Roaming DC')).not.toBeInTheDocument();
    expect(screen.queryByText('Monthly Base Fee')).not.toBeInTheDocument();
    expect(screen.queryByText('Session Fee')).not.toBeInTheDocument();
  });

  it('shows no upcoming UI when the logical tariff visibility is none', () => {
    // Arrange: Render a logical tariff whose next change is intentionally hidden.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: { kind: 'none' },
        }),
      ],
    }));

    // Act: Render the tariff list.
    renderTariffList();

    // Assert: No update indicator or preview block is rendered.
    expect(screen.queryByText(/update scheduled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/next update/i)).not.toBeInTheDocument();
  });

  it('shows a quiet upcoming indicator without future prices for indicator state', () => {
    // Arrange: Render a logical tariff inside the mid-range update window.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: {
            kind: 'indicator',
            effectiveDate: '2026-07-18',
            label: 'Update scheduled · 18 Jul 2026',
          },
        }),
      ],
    }));

    // Act: Render the tariff list.
    renderTariffList();

    // Assert: Only the quiet indicator copy is visible.
    expect(screen.getByText('Update scheduled · 18 Jul 2026')).toBeInTheDocument();
    expect(screen.queryByText(/domestic dc 0,53 €/i)).not.toBeInTheDocument();
  });

  it('shows only changed categories in the preview state', () => {
    // Arrange: Render a logical tariff with an imminent next version.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: {
            kind: 'preview',
            effectiveDate: '2026-07-06',
            label: 'Next Update · 06 Jul 2026',
            changes: [
              { label: 'Domestic DC', valueCents: 53 },
              { label: 'Roaming DC', valueCents: 63 },
            ],
          },
        }),
      ],
    }));

    // Act: Render the tariff list.
    renderTariffList();

    // Assert: The preview renders changed categories only and leaves unchanged ones out.
    const previewLabel = screen.getByText('Next Update · 06 Jul 2026');
    const previewSection = previewLabel.parentElement;

    expect(previewLabel).toBeInTheDocument();
    expect(previewSection).not.toBeNull();
    expect(within(previewSection as HTMLElement).getByText('Domestic DC 0,53 € · Roaming DC 0,63 €')).toBeInTheDocument();
    expect(within(previewSection as HTMLElement).queryByText(/domestic ac/i)).not.toBeInTheDocument();
  });

  it('does not render legacy upcoming header badges for non-promo visibility', () => {
    // Arrange: Render non-promo upcoming changes in both supported visibility states.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          key: 'p1::indicator',
          name: 'Indicator',
          badge: {
            kind: 'upcoming_change',
            date: '2026-07-18',
            label: 'Upcoming change on 18 Jul',
          },
          upcomingVisibility: {
            kind: 'indicator',
            effectiveDate: '2026-07-18',
            label: 'Update scheduled · 18 Jul 2026',
          },
        }),
        buildLogicalTariff({
          key: 'p1::preview',
          name: 'Preview',
          badge: {
            kind: 'upcoming_change',
            date: '2026-07-06',
            label: 'Upcoming change on 06 Jul',
          },
          upcomingVisibility: {
            kind: 'preview',
            effectiveDate: '2026-07-06',
            label: 'Next Update · 06 Jul 2026',
            changes: [{ label: 'Domestic DC', valueCents: 53 }],
          },
        }),
      ],
    }));

    // Act: Render the tariff list.
    renderTariffList();

    // Assert: Legacy upcoming-change badges stay out of the header while the new UI renders.
    expect(screen.queryByText('Upcoming change on 18 Jul')).not.toBeInTheDocument();
    expect(screen.queryByText('Upcoming change on 06 Jul')).not.toBeInTheDocument();
    expect(screen.getByText('Update scheduled · 18 Jul 2026')).toBeInTheDocument();
    expect(screen.getByText('Next Update · 06 Jul 2026')).toBeInTheDocument();
  });

  it('keeps promo badges visible in the header alongside upcoming visibility UI', () => {
    // Arrange: Render a promotional badge together with an upcoming indicator.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: {
            kind: 'promo',
            date: '2026-08-31',
            label: 'Promo until 31 Aug',
          },
          upcomingVisibility: {
            kind: 'indicator',
            effectiveDate: '2026-08-15',
            label: 'Update scheduled · 15 Aug 2026',
          },
        }),
      ],
    }));

    // Act: Render the tariff list.
    renderTariffList();

    // Assert: Promo copy still renders while the new upcoming UI remains available.
    expect(screen.getByText('Promo until 31 Aug')).toBeInTheDocument();
    expect(screen.getByText('Update scheduled · 15 Aug 2026')).toBeInTheDocument();
  });

  it('opens reachable version history from the card', async () => {
    // Arrange: Render a logical tariff with promotion and restoration history labels.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: {
            kind: 'promo',
            date: '2026-08-31',
            label: 'Promo until 31 Aug',
          },
          history: [
            {
              plan: buildPlan({ id: 'baseline', valid_to: utc('2026-08-10'), ac_price_per_kwh: 29 }),
              labels: ['Past'],
              startDate: '2026-01-01',
              endDateInclusive: '2026-08-09',
            },
            {
              plan: buildPlan({ id: 'promo', valid_from: utc('2026-08-10'), valid_to: utc('2026-09-01'), ac_price_per_kwh: 19 }),
              labels: ['Promotion', 'Current'],
              startDate: '2026-08-10',
              endDateInclusive: '2026-08-31',
            },
            {
              plan: buildPlan({ id: 'restore', valid_from: utc('2026-09-01'), ac_price_per_kwh: 29 }),
              labels: ['Restored', 'Scheduled'],
              startDate: '2026-09-01',
              endDateInclusive: null,
            },
          ],
        }),
      ],
    }));
    const user = userEvent.setup();

    // Act: Open the explicit history trigger from the card.
    renderTariffList();
    await user.click(screen.getByRole('button', { name: /view history for ionity lidl/i }));

    // Assert: The history surface becomes reachable and shows role labels.
    expect(screen.getByRole('heading', { name: /tariff history/i })).toBeInTheDocument();
    expect(screen.getByText('Promotion')).toBeInTheDocument();
    expect(screen.getByText('Restored')).toBeInTheDocument();
  });

  it('requires explicit confirmation before deleting the logical tariff', async () => {
    // Arrange: Render one logical tariff and capture the delete mutation.
    const deleteLogicalTariff = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ deleteLogicalTariff }));
    const user = userEvent.setup();
    renderTariffList();

    // Act: Open the delete dialog, then confirm deletion explicitly.
    await openMenuAndChoose('Delete tariff');
    expect(deleteLogicalTariff).not.toHaveBeenCalled();
    expect(screen.getByText(/all scheduled changes and promotions/i)).toBeInTheDocument();
    expect(screen.getByText(/historical charging sessions will keep their saved prices/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete complete tariff/i }));

    // Assert: The logical delete runs only after confirmation.
    await waitFor(() => expect(deleteLogicalTariff).toHaveBeenCalledTimes(1));
  });

  it('opens details, permanent change, and promotion surfaces from their actions', async () => {
    // Arrange: Render one logical tariff card with grouped actions.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());
    const user = userEvent.setup();

    // Act: Open the details surface from the visible action.
    renderTariffList();
    await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }));
    expect(screen.getByText(/tariff form:details:lidl/i)).toBeInTheDocument();

    // Act: Re-render and open the permanent change surface from the overflow action.
    cleanup();
    renderTariffList();
    await openMenu();
    expect(screen.getByRole('button', { name: /edit details/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change price permanently/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run temporary promotion/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete tariff/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit details/i }));
    expect(screen.getByText(/tariff form:details:lidl/i)).toBeInTheDocument();

    cleanup();
    renderTariffList();
    await openMenuAndChoose('Change price permanently');
    expect(screen.getByText('Permanent Price Change Form')).toBeInTheDocument();

    // Act: Re-render and open the promotion surface from the overflow action.
    cleanup();
    renderTariffList();
    await openMenuAndChoose('Run temporary promotion');

    // Assert: Each required action reaches the expected child surface.
    expect(screen.getByText('Temporary Promotion Form')).toBeInTheDocument();
  });

  it('submits logical details updates and closes the surface on success', async () => {
    // Arrange: Render one logical tariff and capture the update mutation.
    const updateLogicalTariffDetails = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ updateLogicalTariffDetails }));
    const user = userEvent.setup();
    renderTariffList();

    // Act: Open details mode and submit the mocked details payload.
    await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Assert: The parent wires logical identity context into the mutation and closes after success.
    await waitFor(() => expect(updateLogicalTariffDetails).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'p1',
      name: 'Lidl',
      nextProviderId: 'p2',
      nextName: 'Renamed Tariff',
      affiliation: 'Family',
      notes: 'Updated note',
    }));
    expect(screen.queryByText(/tariff form:details:lidl/i)).not.toBeInTheDocument();
  });

  it('submits a permanent change, keeps errors visible on failure, and closes on success', async () => {
    // Arrange: First reject, then resolve, so the surface exercises both parent paths.
    const schedulePermanentChange = vi.fn()
      .mockRejectedValueOnce(new Error('Conflict while scheduling change'))
      .mockResolvedValueOnce(undefined);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ schedulePermanentChange }));
    const user = userEvent.setup();
    renderTariffList();

    // Act: Submit once to hit the failure path, then submit again to succeed.
    await openMenuAndChoose('Change price permanently');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Assert: The child stays mounted and shows the propagated error.
    expect(await screen.findByRole('alert')).toHaveTextContent('Conflict while scheduling change');
    expect(screen.getByText('Permanent Price Change Form')).toBeInTheDocument();

    // Act: Retry with the next successful response.
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Assert: The mutation receives logical identity plus version payload and the surface closes.
    await waitFor(() => expect(schedulePermanentChange).toHaveBeenLastCalledWith({
      userId: 'user-1',
      providerId: 'p1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: {
        ac_price_per_kwh: 31,
        dc_price_per_kwh: 51,
        monthly_base_fee: 0,
        session_fee: 0,
      },
    }));
    expect(screen.queryByText('Permanent Price Change Form')).not.toBeInTheDocument();
  });

  it('submits a promotion workflow and closes the surface on success', async () => {
    // Arrange: Render one logical tariff and capture the promotion mutation.
    const schedulePromotion = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ schedulePromotion }));
    const user = userEvent.setup();
    renderTariffList();

    // Act: Open the promotion form and submit the mocked payload.
    await openMenuAndChoose('Run temporary promotion');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Assert: The promotion mutation receives logical identity and closes on success.
    await waitFor(() => expect(schedulePromotion).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'p1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-31'),
      prices: {
        ac_price_per_kwh: 19,
        dc_price_per_kwh: 39,
        monthly_base_fee: 0,
        session_fee: 0,
      },
    }));
    expect(screen.queryByText('Temporary Promotion Form')).not.toBeInTheDocument();
  });

  it('assigns the authenticated user id when creating a new tariff', async () => {
    // Arrange: Render the create flow with a blank incoming user id from the form shell.
    const addChargingPlan = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ addChargingPlan }));
    const user = userEvent.setup();
    renderTariffList({ isCreatingTariff: true });

    // Act: Submit the mocked create form payload.
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Assert: The saved plan is attributed to the authenticated local user.
    await waitFor(() => expect(addChargingPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: 'created-plan',
      provider_id: 'p1',
      name: 'Created Tariff',
      user_id: 'user-1',
    })));
  });

  it('resets an active surface when the logical tariff disappears on rerender', async () => {
    // Arrange: Open details for an initially available logical tariff.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());
    const user = userEvent.setup();
    const view = renderTariffList();

    await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }));
    expect(screen.getByText(/tariff form:details:lidl/i)).toBeInTheDocument();

    // Act: Simulate a live-query update where that logical tariff no longer exists.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [],
      plans: [],
    }));
    view.rerender(
      <TariffList
        isCreatingTariff={false}
        onCreateTariffChange={vi.fn()}
      />,
    );

    // Assert: The stale surface no longer blocks the empty state or add action.
    expect(screen.queryByText(/tariff form:details:lidl/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add tariff/i })).toBeInTheDocument();
    expect(screen.getByText(/no tariffs yet/i)).toBeInTheDocument();
  });
});
