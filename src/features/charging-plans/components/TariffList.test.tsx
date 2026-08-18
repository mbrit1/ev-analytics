import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TariffList } from './TariffList';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { useAuth } from '../../auth';
import type { ChargingPlan, Provider } from '../../../infra/db';
import type { LogicalTariff } from '../model/logicalTariffs';
import { PaidTariffOverlapError } from '../services/planService';
import { DuplicateProviderNameError } from '../services/providerService';

let mockedTariffEditIntent: 'update_current' | 'create_successor' = 'update_current';
let mockedCreatePlanOverrides: Partial<ChargingPlan> = {};
let mockedStagedProvider: { id: string; name: string } | undefined;
let replaceSubmitDuringAsyncOpen = false;

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
    const [submitVersion, setSubmitVersion] = useState(0);

    const handleSubmit = async () => {
      if (replaceSubmitDuringAsyncOpen) {
        setSubmitVersion((version) => version + 1);
      }
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
          const submission = {
            intent: 'create',
            plan: buildPlan({
              id: 'created-plan',
              user_id: '',
              provider_id: 'p1',
              name: 'Created Tariff',
              ...mockedCreatePlanOverrides,
            }),
            ...(mockedStagedProvider ? { stagedProvider: mockedStagedProvider } : {}),
          } as const;
          await resolved.onSubmit?.(submission);
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
        <button key={submitVersion} type="submit" onClick={handleSubmit}>Submit</button>
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
    lifecycle: overrides.lifecycle ?? {
      kind: 'current',
      finalEffectiveVersion: successor,
      finalActiveDate: null,
    },
    history: overrides.history ?? [],
  };
};

type ChargingPlansHookValue = ReturnType<typeof useChargingPlans>;
type TestChargingPlansHookValue = ChargingPlansHookValue & {
  addProviderWithFirstTariff?: (input: { provider: Provider; plan: ChargingPlan }) => Promise<void>;
  switchActivePaidTariff?: (input: { candidate: ChargingPlan; incumbentId: string }) => Promise<void>;
};

const buildHookValue = (
  overrides: Partial<TestChargingPlansHookValue> = {},
): TestChargingPlansHookValue => {
  const logicalTariff = buildLogicalTariff();

  return {
    planVersions: overrides.planVersions ?? logicalTariff.versions,
    logicalTariffs: overrides.logicalTariffs ?? [logicalTariff],
    isLoading: overrides.isLoading ?? false,
    addChargingPlan: overrides.addChargingPlan ?? vi.fn(),
    addProviderWithFirstTariff: overrides.addProviderWithFirstTariff ?? vi.fn(),
    updateCurrentVersion: overrides.updateCurrentVersion ?? vi.fn(),
    createSuccessorVersion: overrides.createSuccessorVersion ?? vi.fn(),
    schedulePromotion: overrides.schedulePromotion ?? vi.fn(),
    deleteLogicalTariff: overrides.deleteLogicalTariff ?? vi.fn(),
    switchActivePaidTariff: overrides.switchActivePaidTariff ?? vi.fn(),
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
    mockedCreatePlanOverrides = {};
    mockedStagedProvider = undefined;
    replaceSubmitDuringAsyncOpen = false;
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

  it('routes an existing-provider create only through addChargingPlan', async () => {
    // Arrange: Submit a create form that keeps the selected existing provider.
    const addChargingPlan = vi.fn().mockResolvedValue(undefined);
    const addProviderWithFirstTariff = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan,
      addProviderWithFirstTariff,
    }));
    renderTariffList({ tariffFormState: { mode: 'create' } });

    // Act: Submit the mocked create form without a staged provider.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));

    // Assert: The regular plan write is the only create operation invoked.
    await waitFor(() => {
      expect(addChargingPlan).toHaveBeenCalledWith(expect.objectContaining({
        provider_id: 'p1',
        user_id: 'user-1',
      }));
    });
    expect(addProviderWithFirstTariff).not.toHaveBeenCalled();
  });

  it('routes a staged provider and first tariff through one combined operation', async () => {
    // Arrange: Stage a new provider whose id is already assigned to the submitted tariff.
    const addChargingPlan = vi.fn().mockResolvedValue(undefined);
    const addProviderWithFirstTariff = vi.fn().mockResolvedValue(undefined);
    const onSaveComplete = vi.fn();
    mockedStagedProvider = { id: 'staged-provider-1', name: 'New CPO' };
    mockedCreatePlanOverrides = {
      provider_id: 'staged-provider-1',
      name: 'First Tariff',
    };
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan,
      addProviderWithFirstTariff,
    }));
    renderTariffList({ tariffFormState: { mode: 'create' }, onSaveComplete });

    // Act: Submit the staged-provider form.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));

    // Assert: Both records receive the authenticated owner and preserve their shared provider id.
    await waitFor(() => {
      expect(addProviderWithFirstTariff).toHaveBeenCalledWith({
        provider: expect.objectContaining({
          id: 'staged-provider-1',
          name: 'New CPO',
          user_id: 'user-1',
        }),
        plan: expect.objectContaining({
          provider_id: 'staged-provider-1',
          name: 'First Tariff',
          user_id: 'user-1',
        }),
      });
    });
    const combinedInput = addProviderWithFirstTariff.mock.calls[0]?.[0];
    expect(combinedInput?.provider.created_at).toBeInstanceOf(Date);
    expect(combinedInput?.provider.updated_at).toBe(combinedInput?.provider.created_at);
    expect(combinedInput?.plan.created_at).toBeInstanceOf(Date);
    expect(combinedInput?.plan.updated_at).toBeInstanceOf(Date);
    expect(addChargingPlan).not.toHaveBeenCalled();
    expect(onSaveComplete).toHaveBeenCalledWith('staged-provider-1::first tariff');
  });

  it('rejects staged provider creation after authentication is lost without local mutation callbacks', async () => {
    // Arrange: Simulate a stale form submit after the authenticated user has signed out.
    const addChargingPlan = vi.fn().mockResolvedValue(undefined);
    const addProviderWithFirstTariff = vi.fn().mockResolvedValue(undefined);
    mockedStagedProvider = { id: 'staged-provider-1', name: 'New CPO' };
    mockedCreatePlanOverrides = {
      user_id: 'stale-submission-user',
      provider_id: 'staged-provider-1',
      name: 'First Tariff',
    };
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan,
      addProviderWithFirstTariff,
    }));
    renderTariffList({ tariffFormState: { mode: 'create' } });

    // Act: Submit the stale staged-provider form.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));

    // Assert: The submission is rejected before either local persistence operation starts.
    expect(await screen.findByRole('alert')).toHaveTextContent('You must be signed in to save a tariff.');
    expect(addProviderWithFirstTariff).not.toHaveBeenCalled();
    expect(addChargingPlan).not.toHaveBeenCalled();
  });

  it('renders a duplicate staged-provider error in the still-mounted create form', async () => {
    // Arrange: Make the combined create operation reject with the domain duplicate-name error.
    const conflictingProvider: Provider = {
      id: 'existing-provider',
      name: 'New CPO',
      user_id: 'user-1',
      created_at: utc('2026-01-01'),
      updated_at: utc('2026-01-01'),
    };
    const addChargingPlan = vi.fn().mockResolvedValue(undefined);
    const addProviderWithFirstTariff = vi.fn()
      .mockRejectedValue(new DuplicateProviderNameError(conflictingProvider));
    mockedStagedProvider = { id: 'staged-provider-1', name: 'New CPO' };
    mockedCreatePlanOverrides = {
      provider_id: 'staged-provider-1',
      name: 'First Tariff',
    };
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan,
      addProviderWithFirstTariff,
    }));
    renderTariffList({ tariffFormState: { mode: 'create' } });

    // Act: Submit the staged-provider form.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));

    // Assert: The typed domain error reaches the mounted form without a standalone plan write.
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider name already exists');
    expect(screen.getByText(/tariff form:create/i)).toBeInTheDocument();
    expect(addProviderWithFirstTariff).toHaveBeenCalledTimes(1);
    expect(addChargingPlan).not.toHaveBeenCalled();
  });

  it('offers a confirmation when create overlaps exactly one earlier paid tariff', async () => {
    // Arrange: Reject the create write with one earlier paid incumbent.
    const candidate = buildPlan({
      id: 'created-plan',
      user_id: 'user-1',
      provider_id: 'p1',
      name: 'Created Tariff',
      valid_from: utc('2026-08-15'),
      monthly_base_fee: 499,
      ac_price_per_kwh: 35,
    });
    const incumbent = buildPlan({
      id: 'incumbent-plan',
      user_id: 'user-1',
      provider_id: 'p1',
      name: 'Current Tariff',
      valid_from: utc('2026-01-01'),
      valid_to: null,
      monthly_base_fee: 299,
      ac_price_per_kwh: 29,
    });
    const addChargingPlan = vi.fn().mockRejectedValue(new PaidTariffOverlapError(candidate, [incumbent]));
    const onSaveComplete = vi.fn();
    mockedCreatePlanOverrides = candidate;
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ addChargingPlan }));
    renderTariffList({ tariffFormState: { mode: 'create' }, onSaveComplete });

    // Act: Submit the candidate form.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' })).catch(() => undefined);

    // Assert: The candidate remains pending in an accessible confirmation and save completion is deferred.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/Ionity/i);
    expect(dialog).toHaveTextContent(/Current Tariff/i);
    expect(dialog).toHaveTextContent(/2026-08-15|15 Aug 2026|15\.08\.2026/i);
    expect(onSaveComplete).not.toHaveBeenCalled();
  });

  it('restores focus to the replacement create submit control after asynchronously opening and cancelling confirmation', async () => {
    // Arrange: Reject the create write with one earlier paid incumbent.
    const candidate = buildPlan({
      id: 'created-plan',
      user_id: 'user-1',
      provider_id: 'p1',
      name: 'Created Tariff',
      valid_from: utc('2026-08-15'),
      monthly_base_fee: 499,
      ac_price_per_kwh: 35,
    });
    const incumbent = buildPlan({
      id: 'incumbent-plan',
      user_id: 'user-1',
      provider_id: 'p1',
      name: 'Current Tariff',
      valid_from: utc('2026-01-01'),
      valid_to: null,
      monthly_base_fee: 299,
      ac_price_per_kwh: 29,
    });
    mockedCreatePlanOverrides = candidate;
    replaceSubmitDuringAsyncOpen = true;
    const overlapError = new PaidTariffOverlapError(candidate, [incumbent]);
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan: vi.fn<() => Promise<void>>(() => new Promise<void>((_, reject) => {
        setTimeout(() => reject(overlapError), 0);
      })),
    }));
    renderTariffList({ tariffFormState: { mode: 'create' } });
    const user = userEvent.setup();

    // Act: Submit, let the pending form replace its submit element, then cancel via Escape.
    const initialSubmit = screen.getByRole('button', { name: 'Submit' });
    await user.click(initialSubmit);
    await screen.findByRole('dialog');
    const replacementSubmit = screen.getByRole('button', { name: 'Submit' });
    expect(initialSubmit).not.toBeInTheDocument();
    expect(replacementSubmit).not.toBe(initialSubmit);
    await user.keyboard('{Escape}');

    // Assert: Cancelling restores focus to the connected replacement submit control.
    expect(replacementSubmit).toHaveFocus();
  });

  it('cancels the paid-tariff confirmation without writing or closing the create form', async () => {
    // Arrange: Prepare a single-incumbent overlap and keep the create form mounted.
    const candidate = buildPlan({
      id: 'created-plan', user_id: 'user-1', provider_id: 'p1', name: 'Created Tariff',
      valid_from: utc('2026-08-15'), monthly_base_fee: 499, ac_price_per_kwh: 35,
    });
    const incumbent = buildPlan({
      id: 'incumbent-plan', user_id: 'user-1', provider_id: 'p1', name: 'Current Tariff',
      valid_from: utc('2026-01-01'), monthly_base_fee: 299, ac_price_per_kwh: 29,
    });
    const addChargingPlan = vi.fn().mockRejectedValue(new PaidTariffOverlapError(candidate, [incumbent]));
    mockedCreatePlanOverrides = candidate;
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ addChargingPlan }));
    renderTariffList({ tariffFormState: { mode: 'create' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' })).catch(() => undefined);

    // Act: Cancel only the confirmation.
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /cancel/i }));

    // Assert: The form remains available and no additional write occurs.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/tariff form:create/i)).toBeInTheDocument();
    expect(addChargingPlan).toHaveBeenCalledTimes(1);
  });

  it('confirms a paid-tariff switch through the hook before completing the save', async () => {
    // Arrange: Reject create, then resolve the explicit switch operation.
    const candidate = buildPlan({
      id: 'created-plan', user_id: 'user-1', provider_id: 'p1', name: 'Created Tariff',
      valid_from: utc('2026-08-15'), monthly_base_fee: 499, ac_price_per_kwh: 35,
    });
    const incumbent = buildPlan({
      id: 'incumbent-plan', user_id: 'user-1', provider_id: 'p1', name: 'Current Tariff',
      valid_from: utc('2026-01-01'), monthly_base_fee: 299, ac_price_per_kwh: 29,
    });
    const addChargingPlan = vi.fn().mockRejectedValue(new PaidTariffOverlapError(candidate, [incumbent]));
    const switchActivePaidTariff = vi.fn().mockResolvedValue(undefined);
    const onSaveComplete = vi.fn();
    mockedCreatePlanOverrides = candidate;
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ addChargingPlan, switchActivePaidTariff }));
    renderTariffList({ tariffFormState: { mode: 'create' }, onSaveComplete });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' })).catch(() => undefined);

    // Act: Confirm the replacement.
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /confirm/i }));

    // Assert: The new hook operation receives candidate and incumbent id, then completion fires.
    await waitFor(() => {
      expect(switchActivePaidTariff).toHaveBeenCalledWith({ candidate, incumbentId: incumbent.id });
      expect(onSaveComplete).toHaveBeenCalledWith('p1::created tariff');
    });
  });

  it('keeps confirmation visible when the paid-tariff switch fails', async () => {
    // Arrange: Make the explicit switch operation fail after confirmation.
    const candidate = buildPlan({
      id: 'created-plan', user_id: 'user-1', provider_id: 'p1', name: 'Created Tariff',
      valid_from: utc('2026-08-15'), monthly_base_fee: 499, ac_price_per_kwh: 35,
    });
    const incumbent = buildPlan({
      id: 'incumbent-plan', user_id: 'user-1', provider_id: 'p1', name: 'Current Tariff',
      valid_from: utc('2026-01-01'), monthly_base_fee: 299, ac_price_per_kwh: 29,
    });
    const switchActivePaidTariff = vi.fn().mockRejectedValue(new Error('switch failed'));
    mockedCreatePlanOverrides = candidate;
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan: vi.fn().mockRejectedValue(new PaidTariffOverlapError(candidate, [incumbent])),
      switchActivePaidTariff,
    }));
    renderTariffList({ tariffFormState: { mode: 'create' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' })).catch(() => undefined);

    // Act: Confirm the switch, which rejects.
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /confirm/i })).catch(() => undefined);

    // Assert: Failure is recoverable and confirmation remains open.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/switch failed|could not switch/i);
  });

  it('does not offer confirmation for ambiguous paid-tariff conflicts', async () => {
    // Arrange: Reject with multiple overlapping paid incumbents.
    const candidate = buildPlan({
      id: 'created-plan', user_id: 'user-1', provider_id: 'p1', name: 'Created Tariff',
      valid_from: utc('2026-08-15'), monthly_base_fee: 499, ac_price_per_kwh: 35,
    });
    const conflicts = [
      buildPlan({ id: 'incumbent-a', user_id: 'user-1', provider_id: 'p1', name: 'Current A', monthly_base_fee: 299 }),
      buildPlan({ id: 'incumbent-b', user_id: 'user-1', provider_id: 'p1', name: 'Current B', monthly_base_fee: 399 }),
    ];
    mockedCreatePlanOverrides = candidate;
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      addChargingPlan: vi.fn().mockRejectedValue(new PaidTariffOverlapError(candidate, conflicts)),
    }));
    renderTariffList({ tariffFormState: { mode: 'create' } });

    // Act: Submit the candidate.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' })).catch(() => undefined);

    // Assert: No unsafe switch affordance is shown; manual repair guidance is surfaced in the form.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/manual|correct.*tariff|existing tariff dates/i);
  });
});
