import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TariffList } from './TariffList';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth';
import type { ChargingPlan } from '../../../infra/db';
import type { LogicalTariff } from '../model/logicalTariffs';

let mockedTariffEditIntent: 'update_current' | 'create_successor' = 'update_current';

vi.mock('../hooks/useChargingPlans');
vi.mock('../hooks/useProviders');
vi.mock('../../auth');
vi.mock('./TariffFormLoader', () => ({
  TariffFormLoader: (props: unknown) => {
    const resolved = props as {
      mode?: 'create' | 'edit';
      initialValues?: Partial<ChargingPlan>;
      onCancel?: () => void;
      onSubmit?: (submission: unknown) => Promise<void>;
    };
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
      try {
        if (resolved.mode === 'edit') {
          await resolved.onSubmit?.({
            intent: mockedTariffEditIntent,
            plan: buildPlan({
              id: mockedTariffEditIntent === 'update_current'
                ? resolved.initialValues?.id ?? 'baseline'
                : 'successor-created',
              user_id: resolved.initialValues?.user_id ?? 'user-1',
              provider_id: resolved.initialValues?.provider_id ?? 'p1',
              name: 'Renamed Tariff',
              valid_from: mockedTariffEditIntent === 'update_current'
                ? resolved.initialValues?.valid_from ?? utc('2026-01-01')
                : utc('2026-08-15'),
              valid_to: resolved.initialValues?.valid_to ?? null,
              ac_price_per_kwh: 31,
              dc_price_per_kwh: 51,
              roaming_ac_price_per_kwh: 61,
              roaming_dc_price_per_kwh: 71,
              monthly_base_fee: 299,
              session_fee: 99,
              affiliation: 'Family',
              notes: 'Updated note',
            }),
            logicalIdentity: {
              providerId: resolved.initialValues?.provider_id ?? 'p1',
              name: resolved.initialValues?.name ?? 'Lidl',
            },
            originalValidFrom: resolved.initialValues?.valid_from ?? utc('2026-01-01'),
          });
        } else {
          await resolved.onSubmit?.({
            intent: 'create',
            plan: buildPlan({
              id: 'created-plan',
              user_id: '',
              provider_id: 'p1',
              name: 'Created Tariff',
            }),
          });
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
vi.mock('./TemporaryPromotionForm', () => ({
  TemporaryPromotionForm: (props: unknown) => {
    const resolved = props as { onCancel?: () => void };
    return (
      <div>
        Temporary Promotion Form
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
    history: overrides.history ?? [],
  };
};

type ChargingPlansHookValue = ReturnType<typeof useChargingPlans>;

const buildHookValue = (
  overrides: Partial<ChargingPlansHookValue> = {},
): ChargingPlansHookValue => {
  const logicalTariff = buildLogicalTariff();

  return {
    planVersions: overrides.planVersions ?? logicalTariff.versions,
    logicalTariffs: overrides.logicalTariffs ?? [logicalTariff],
    isLoading: overrides.isLoading ?? false,
    addChargingPlan: overrides.addChargingPlan ?? vi.fn(),
    updateCurrentVersion: overrides.updateCurrentVersion ?? vi.fn(),
    createSuccessorVersion: overrides.createSuccessorVersion ?? vi.fn(),
    schedulePromotion: overrides.schedulePromotion ?? vi.fn(),
    deleteLogicalTariff: overrides.deleteLogicalTariff ?? vi.fn(),
  };
};

const renderTariffList = (
  props: Partial<React.ComponentProps<typeof TariffList>> = {},
) => render(
  <TariffList
    tariffFormState={props.tariffFormState ?? { mode: 'closed' }}
    restorationRequest={props.restorationRequest}
    onCreateTariff={props.onCreateTariff ?? vi.fn()}
    onEditTariff={props.onEditTariff ?? vi.fn()}
    onCloseForm={props.onCloseForm ?? vi.fn()}
    onSaveComplete={props.onSaveComplete ?? vi.fn()}
    onRestorationComplete={props.onRestorationComplete ?? vi.fn()}
    onFormOpenChange={props.onFormOpenChange}
  />,
);

const tariffListElement = (
  props: Partial<React.ComponentProps<typeof TariffList>> = {},
) => (
  <TariffList
    tariffFormState={props.tariffFormState ?? { mode: 'closed' }}
    restorationRequest={props.restorationRequest}
    onCreateTariff={props.onCreateTariff ?? vi.fn()}
    onEditTariff={props.onEditTariff ?? vi.fn()}
    onCloseForm={props.onCloseForm ?? vi.fn()}
    onSaveComplete={props.onSaveComplete ?? vi.fn()}
    onRestorationComplete={props.onRestorationComplete ?? vi.fn()}
    onFormOpenChange={props.onFormOpenChange}
  />
);

async function openMenuAndChoose(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
  await user.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
}

/**
 * Test suite for grouped logical-tariff overview cards and unified edit workflows.
 *
 * Verifies grouped list rendering, app-owned create/edit mode, remaining menu
 * actions, and focused restoration after cancel/save.
 */
describe('TariffList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTariffEditIntent = 'update_current';
    vi.stubGlobal('scrollTo', vi.fn());
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
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());

    // Act: Render the grouped tariff list.
    renderTariffList();

    // Assert: The list shows one grouped card, the upcoming indicator, and the current price.
    expect(screen.getAllByRole('button', { name: /edit ionity lidl/i })).toHaveLength(1);
    expect(screen.getByText('Update scheduled · 15 Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('0,29 €')).toBeInTheDocument();
  });

  it('hides optional fee rows that have no current value', () => {
    // Arrange: Render a logical tariff whose current version only has per-kWh prices.
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
            roaming_ac_price_per_kwh: 0,
            roaming_dc_price_per_kwh: 0,
            monthly_base_fee: 0,
            session_fee: 0,
          }),
        }),
      ],
    }));

    // Act: Render the tariff cards.
    renderTariffList();

    // Assert: Roaming zero values remain visible while zero-fee rows stay hidden.
    expect(screen.getByText('Roaming AC')).toBeInTheDocument();
    expect(screen.getByText('Roaming DC')).toBeInTheDocument();
    expect(screen.queryByText('Monthly Base Fee')).not.toBeInTheDocument();
    expect(screen.queryByText('Session Fee')).not.toBeInTheDocument();
  });

  it('shows only preview copy for the preview upcoming state', () => {
    // Arrange: Render a logical tariff with an imminent preview.
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

    // Act: Render the list.
    renderTariffList();

    // Assert: Changed categories are summarized in the preview block.
    expect(screen.getByText('Next Update · 06 Jul 2026')).toBeInTheDocument();
    expect(screen.getByText('Domestic DC 0,53 € · Roaming DC 0,63 €')).toBeInTheDocument();
  });

  it('omits roaming prices without values from the upcoming preview', () => {
    // Arrange: Render a preview where both roaming prices are unavailable.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: {
            kind: 'preview',
            effectiveDate: '2026-07-01',
            label: 'Next Update · 01 Jul 2026',
            changes: [
              { label: 'Domestic AC', valueCents: 59 },
              { label: 'Roaming AC', valueCents: null },
              { label: 'Roaming DC', valueCents: null },
            ],
          },
        }),
      ],
    }));

    // Act: Render the tariff cards.
    renderTariffList();

    // Assert: The valued change remains while unavailable roaming entries are absent.
    expect(screen.getByText('Domestic AC 0,59 €')).toBeInTheDocument();
    expect(screen.queryByText(/roaming ac/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/roaming dc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it('opens app-owned edit mode from the primary edit action', async () => {
    // Arrange: Render TariffList with tariffFormState closed and onEditTariff spy.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());
    const onEditTariff = vi.fn();
    const user = userEvent.setup();
    renderTariffList({ onEditTariff });

    // Act: Click "Edit Ionity Lidl".
    await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }));

    // Assert: onEditTariff receives the logical tariff key.
    expect(onEditTariff).toHaveBeenCalledWith('p1::lidl');
  });

  it('hides the list while app-owned edit form is visible', () => {
    // Arrange: Render TariffList with tariffFormState { mode: "edit", logicalTariffKey: "p1::lidl" }.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());
    renderTariffList({ tariffFormState: { mode: 'edit', logicalTariffKey: 'p1::lidl' } });

    // Assert: "Edit Tariff" is visible and the tariff card is not visible.
    expect(screen.getByText(/tariff form:edit:lidl/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit ionity lidl/i })).not.toBeInTheDocument();
  });

  it('dispatches updateCurrentVersion when edit submit keeps valid from unchanged', async () => {
    // Arrange: Render edit mode with a mocked TariffFormLoader submission intent "update_current".
    const updateCurrentVersion = vi.fn();
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ updateCurrentVersion }));
    renderTariffList({
      tariffFormState: { mode: 'edit', logicalTariffKey: 'p1::lidl' },
      onSaveComplete: vi.fn(),
    });

    // Act: Submit the mocked edit form.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));

    // Assert: updateCurrentVersion receives currentVersionId, dates, prices, nextName, affiliation, and notes.
    expect(updateCurrentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        currentVersionId: 'baseline',
        validFrom: utc('2026-01-01'),
        validTo: utc('2026-08-15'),
        nextName: 'Renamed Tariff',
        affiliation: 'Family',
        notes: 'Updated note',
        prices: {
          ac_price_per_kwh: 31,
          dc_price_per_kwh: 51,
          roaming_ac_price_per_kwh: 61,
          roaming_dc_price_per_kwh: 71,
          monthly_base_fee: 299,
          session_fee: 99,
        },
      }),
    );
  });

  it('dispatches createSuccessorVersion when edit submit changes valid from', async () => {
    // Arrange: Render edit mode with a mocked TariffFormLoader submission intent "create_successor".
    mockedTariffEditIntent = 'create_successor';
    const createSuccessorVersion = vi.fn();
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ createSuccessorVersion }));
    renderTariffList({
      tariffFormState: { mode: 'edit', logicalTariffKey: 'p1::lidl' },
      onSaveComplete: vi.fn(),
    });

    // Act: Submit the mocked edit form.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));

    // Assert: createSuccessorVersion receives effectiveFrom, validTo, prices, nextName, affiliation, and notes.
    expect(createSuccessorVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveFrom: utc('2026-08-15'),
        validTo: utc('2026-08-15'),
        nextName: 'Renamed Tariff',
        affiliation: 'Family',
        notes: 'Updated note',
        prices: {
          ac_price_per_kwh: 31,
          dc_price_per_kwh: 51,
          roaming_ac_price_per_kwh: 61,
          roaming_dc_price_per_kwh: 71,
          monthly_base_fee: 299,
          session_fee: 99,
        },
      }),
    );
  });

  it('keeps promotion and delete available from the overflow menu', async () => {
    // Arrange: Render a closed list state with one logical tariff.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());
    renderTariffList();

    // Act: Open the action menu.
    await openMenuAndChoose('Run temporary promotion');

    // Assert: Promotion stays available and the old actions are gone.
    expect(screen.getByText('Temporary Promotion Form')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change price permanently/i })).not.toBeInTheDocument();
  });

  it('restores list position and focus after cancel', async () => {
    // Arrange: Render a closed list with a restoration request from the app shell.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue());
    const onRestorationComplete = vi.fn();
    renderTariffList({
      restorationRequest: { type: 'position', scrollY: 640, focusTariffKey: 'p1::lidl' },
      onRestorationComplete,
    });

    // Assert: The list scroll restore is applied and completion is acknowledged.
    await waitFor(() => {
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
      expect(screen.getByRole('button', { name: /edit ionity lidl/i })).toHaveFocus();
      expect(onRestorationComplete).toHaveBeenCalled();
    });
  });

  it('waits to complete tariff focus restoration until the saved tariff appears', async () => {
    // Arrange: Start with a post-save restoration request before the renamed card is present.
    const onRestorationComplete = vi.fn();
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ logicalTariffs: [] }));
    const restoredTariff = buildLogicalTariff({
      key: 'p1::renamed-tariff',
      name: 'Renamed Tariff',
      versions: [
        buildPlan({
          id: 'renamed',
          provider_id: 'p1',
          name: 'Renamed Tariff',
          valid_from: utc('2026-01-01'),
          ac_price_per_kwh: 31,
        }),
      ],
      currentVersion: buildPlan({
        id: 'renamed',
        provider_id: 'p1',
        name: 'Renamed Tariff',
        valid_from: utc('2026-01-01'),
        ac_price_per_kwh: 31,
      }),
      nextVersion: null,
      upcomingVisibility: { kind: 'none' },
    });
    const { rerender } = render(tariffListElement({
      restorationRequest: { type: 'tariff', tariffKey: 'p1::renamed-tariff' },
      onRestorationComplete,
    }));

    // Act: Simulate the live query refresh that adds the renamed card after save.
    expect(onRestorationComplete).not.toHaveBeenCalled();
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ logicalTariffs: [restoredTariff] }));
    rerender(tariffListElement({
      restorationRequest: { type: 'tariff', tariffKey: 'p1::renamed-tariff' },
      onRestorationComplete,
    }));

    // Assert: Completion is acknowledged only after focus lands on the refreshed card.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit ionity renamed tariff/i })).toHaveFocus();
      expect(onRestorationComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a recoverable message when the requested edit target is missing', async () => {
    // Arrange: Render edit mode for a logical tariff key that is no longer loaded.
    const onCloseForm = vi.fn();
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ logicalTariffs: [] }));
    renderTariffList({
      tariffFormState: { mode: 'edit', logicalTariffKey: 'p1::missing' },
      onCloseForm,
    });

    // Act: Return to the list from the missing-target fallback.
    await userEvent.setup().click(screen.getByRole('button', { name: /back to tariffs/i }));

    // Assert: The blank-state trap is replaced by a visible fallback and cancel path.
    expect(screen.getByText(/tariff is no longer available/i)).toBeInTheDocument();
    expect(onCloseForm).toHaveBeenCalledTimes(1);
  });
});
