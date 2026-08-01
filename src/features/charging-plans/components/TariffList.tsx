import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Plus } from 'lucide-react';
import { formatCurrency } from '../../../shared/lib';
import { Slab } from '../../../shared/ui';
import { useAuth } from '../../auth';
import type { ChargingPlan, Provider } from '../../../infra/db';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { getLogicalTariffKey, type LogicalTariffUpcomingVisibility } from '../model/logicalTariffs';
import { DeleteLogicalTariffDialog } from './DeleteLogicalTariffDialog';
import type { TariffFormSubmit } from './TariffForm';
import { TariffFormLoader } from './TariffFormLoader';
import { TariffVersionActionMenu } from './TariffVersionActionMenu';
import { TemporaryPromotionForm } from './TemporaryPromotionForm';
import { PaidTariffSwitchDialog } from './PaidTariffSwitchDialog';
import { PaidTariffOverlapError } from '../services/planService';

type TariffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; logicalTariffKey: string };

type TariffRestoreRequest =
  | { type: 'position'; scrollY: number; focusTariffKey?: string | null }
  | { type: 'tariff'; tariffKey: string };

type TariffSurface =
  | { kind: 'none' }
  | { kind: 'promotion'; key: string }
  | { kind: 'delete'; key: string };

interface PendingPaidTariffSwitch {
  candidate: ChargingPlan;
  incumbent: ChargingPlan;
  providerName: string;
  restoreFocusElement: HTMLElement | null;
  resolveRestoreFocusElement: () => HTMLElement | null;
}

/**
 * Tariffs screen backed by the charging-plan domain.
 */
interface TariffListProps {
  tariffFormState: TariffFormState;
  restorationRequest?: TariffRestoreRequest;
  onCreateTariff: () => void;
  onEditTariff: (logicalTariffKey: string) => void;
  onCloseForm: () => void;
  onSaveComplete: (logicalTariffKey: string) => void;
  onRestorationComplete: () => void;
  onFormOpenChange?: (isOpen: boolean) => void;
}

interface CurrentPricingRowsProps {
  plan: ChargingPlan | null;
}

function shouldRenderAmount(amount: number | undefined): amount is number {
  return amount != null;
}

function shouldRenderFeeAmount(amount: number | undefined): amount is number {
  return amount != null && amount > 0;
}

function CurrentPricingRows({ plan }: CurrentPricingRowsProps) {
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
      {shouldRenderAmount(plan?.ac_price_per_kwh) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Domestic AC</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.ac_price_per_kwh)}
          </span>
        </div>
      )}
      {shouldRenderAmount(plan?.dc_price_per_kwh) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Domestic DC</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.dc_price_per_kwh)}
          </span>
        </div>
      )}
      {shouldRenderAmount(plan?.roaming_ac_price_per_kwh) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Roaming AC</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.roaming_ac_price_per_kwh)}
          </span>
        </div>
      )}
      {shouldRenderAmount(plan?.roaming_dc_price_per_kwh) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Roaming DC</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.roaming_dc_price_per_kwh)}
          </span>
        </div>
      )}
      {shouldRenderFeeAmount(plan?.monthly_base_fee) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Monthly Base Fee</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.monthly_base_fee)}
          </span>
        </div>
      )}
      {shouldRenderFeeAmount(plan?.session_fee) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Session Fee</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.session_fee)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatUpcomingPreviewCopy(
  upcomingVisibility: Extract<LogicalTariffUpcomingVisibility, { kind: 'preview' }>,
): string {
  return upcomingVisibility.changes
    .flatMap((change) => (
      change.valueCents == null
        ? []
        : [`${change.label} ${formatCurrency(change.valueCents)}`]
    ))
    .join(' · ');
}

function getLogicalTariffLabel(providerName: string, tariffName: string): string {
  return tariffName ? `${providerName} ${tariffName}` : providerName;
}

/**
 * Tariffs screen backed by the charging-plan domain.
 */
export function TariffList({
  tariffFormState,
  restorationRequest,
  onCreateTariff,
  onEditTariff,
  onCloseForm,
  onSaveComplete,
  onRestorationComplete,
  onFormOpenChange,
}: TariffListProps) {
  const {
    logicalTariffs,
    addChargingPlan,
    addProviderWithFirstTariff,
    isLoading,
    updateCurrentVersion,
    createSuccessorVersion,
    schedulePromotion,
    deleteLogicalTariff,
    switchActivePaidTariff,
  } = useChargingPlans();
  const { providers } = useProviders();
  const { user } = useAuth();
  const [surface, setSurface] = useState<TariffSurface>({ kind: 'none' });
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [pendingPaidTariffSwitch, setPendingPaidTariffSwitch] = useState<PendingPaidTariffSwitch | null>(null);
  const [paidTariffSwitchPending, setPaidTariffSwitchPending] = useState(false);
  const [paidTariffSwitchError, setPaidTariffSwitchError] = useState<string | null>(null);
  const editButtonElementsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const createTariffFormRef = useRef<HTMLDivElement>(null);

  const providerNameById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const logicalTariffsByKey = useMemo(
    () => new Map((logicalTariffs ?? []).map((logicalTariff) => [logicalTariff.key, logicalTariff])),
    [logicalTariffs],
  );
  const resolvedSurface: TariffSurface = surface.kind !== 'none' && !logicalTariffsByKey.has(surface.key)
    ? { kind: 'none' }
    : surface;
  const activeSurfaceLogicalTariff = resolvedSurface.kind === 'none'
    ? null
    : logicalTariffsByKey.get(resolvedSurface.key) ?? null;
  const isShellOwnedFormVisible = tariffFormState.mode !== 'closed';
  const isCreateOpen = tariffFormState.mode === 'create';
  const activeEditLogicalTariff = tariffFormState.mode === 'edit'
    ? logicalTariffsByKey.get(tariffFormState.logicalTariffKey) ?? null
    : null;
  const hasLogicalTariffs = (logicalTariffs ?? []).length > 0;
  const isMissingEditTarget = tariffFormState.mode === 'edit' && activeEditLogicalTariff == null;

  useEffect(() => {
    onFormOpenChange?.(isShellOwnedFormVisible);
  }, [isShellOwnedFormVisible, onFormOpenChange]);

  useEffect(() => {
    if (!restorationRequest) return;

    if (restorationRequest.type === 'position') {
      window.scrollTo({ top: restorationRequest.scrollY, behavior: 'auto' });
      const focusKey = restorationRequest.focusTariffKey;
      if (focusKey) {
        editButtonElementsRef.current[focusKey]?.focus();
      }
      onRestorationComplete();
      return;
    }

    if (restorationRequest.type === 'tariff') {
      const editButton = editButtonElementsRef.current[restorationRequest.tariffKey];
      if (!editButton) return;
      editButton.focus();
      onRestorationComplete();
    }
  }, [logicalTariffs, onRestorationComplete, restorationRequest]);

  const handleCreateSubmit = async (submission: TariffFormSubmit) => {
    const candidate = { ...submission.plan, user_id: user?.id ?? submission.plan.user_id };
    const restoreFocusElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const resolveRestoreFocusElement = () => (
      createTariffFormRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null
    );
    try {
      if (submission.intent === 'create' && submission.stagedProvider) {
        const now = new Date();
        const provider: Provider = {
          id: submission.stagedProvider.id,
          name: submission.stagedProvider.name,
          user_id: user?.id ?? submission.plan.user_id,
          created_at: now,
          updated_at: now,
        };
        await addProviderWithFirstTariff({ provider, plan: candidate });
        onSaveComplete(getLogicalTariffKey({ provider_id: candidate.provider_id, name: candidate.name }));
        return;
      }
      await addChargingPlan(candidate);
      onSaveComplete(getLogicalTariffKey({ provider_id: candidate.provider_id, name: candidate.name }));
    } catch (error) {
      if (!(error instanceof PaidTariffOverlapError)) throw error;
      const incumbent = error.conflicts.length === 1 ? error.conflicts[0] : null;
      const canSwitch = candidate.monthly_base_fee > 0
        && incumbent != null
        && incumbent.monthly_base_fee > 0
        && incumbent.valid_from.getTime() < candidate.valid_from.getTime();
      if (!canSwitch) {
        throw new Error(
          'This paid tariff overlaps ambiguously with existing tariffs. Correct the existing tariff dates manually.',
          { cause: error },
        );
      }
      setPaidTariffSwitchError(null);
      setPendingPaidTariffSwitch({
        candidate,
        incumbent,
        providerName: providerNameById.get(candidate.provider_id) ?? candidate.provider_id,
        restoreFocusElement,
        resolveRestoreFocusElement,
      });
    }
  };

  const confirmPaidTariffSwitch = async () => {
    if (!pendingPaidTariffSwitch) return;
    setPaidTariffSwitchPending(true);
    setPaidTariffSwitchError(null);
    try {
      await switchActivePaidTariff({
        candidate: pendingPaidTariffSwitch.candidate,
        incumbentId: pendingPaidTariffSwitch.incumbent.id,
      });
      onSaveComplete(getLogicalTariffKey({
        provider_id: pendingPaidTariffSwitch.candidate.provider_id,
        name: pendingPaidTariffSwitch.candidate.name,
      }));
      setPendingPaidTariffSwitch(null);
    } catch (error) {
      setPaidTariffSwitchError(error instanceof Error ? error.message : 'Could not switch paid tariff.');
    } finally {
      setPaidTariffSwitchPending(false);
    }
  };

  const handleEditSubmit = async (submission: TariffFormSubmit) => {
    if (submission.intent === 'create' || activeEditLogicalTariff == null) {
      return;
    }

    const prices = {
      ac_price_per_kwh: submission.plan.ac_price_per_kwh,
      dc_price_per_kwh: submission.plan.dc_price_per_kwh,
      roaming_ac_price_per_kwh: submission.plan.roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh: submission.plan.roaming_dc_price_per_kwh,
      monthly_base_fee: submission.plan.monthly_base_fee,
      session_fee: submission.plan.session_fee,
    };

    if (submission.intent === 'update_current') {
      await updateCurrentVersion?.({
        userId: user?.id ?? '',
        providerId: activeEditLogicalTariff.providerId,
        name: activeEditLogicalTariff.name,
        currentVersionId: submission.plan.id,
        validFrom: submission.plan.valid_from,
        validTo: submission.plan.valid_to ?? null,
        nextName: submission.plan.name,
        prices,
        affiliation: submission.plan.affiliation,
        notes: submission.plan.notes,
      });
    }

    if (submission.intent === 'create_successor') {
      await createSuccessorVersion?.({
        userId: user?.id ?? '',
        providerId: activeEditLogicalTariff.providerId,
        name: activeEditLogicalTariff.name,
        effectiveFrom: submission.plan.valid_from,
        validTo: submission.plan.valid_to ?? null,
        nextName: submission.plan.name,
        prices,
        affiliation: submission.plan.affiliation,
        notes: submission.plan.notes,
      });
    }

    onSaveComplete(getLogicalTariffKey({
      provider_id: submission.plan.provider_id,
      name: submission.plan.name,
    }));
  };

  if (isLoading) {
    return <div>Loading tariffs...</div>;
  }

  return (
    <div className="space-y-4">
      {!isShellOwnedFormVisible && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-primary">Tariffs</h1>
          <button
            type="button"
            onClick={onCreateTariff}
            className="hidden min-h-[44px] items-center rounded-xl bg-accent px-4 py-2 font-bold text-white shadow-md shadow-accent/20 transition-all hover:opacity-90 md:flex"
          >
            <Plus className="mr-2 h-5 w-5" />
            Add Tariff
          </button>
        </div>
      )}

      {isCreateOpen && (
        <div ref={createTariffFormRef}>
          <TariffFormLoader
            mode="create"
            onSubmit={handleCreateSubmit}
            onCancel={onCloseForm}
          />
        </div>
      )}

      {pendingPaidTariffSwitch && (
        <PaidTariffSwitchDialog
          providerName={pendingPaidTariffSwitch.providerName}
          incumbentName={pendingPaidTariffSwitch.incumbent.name}
          candidateStart={pendingPaidTariffSwitch.candidate.valid_from}
          restoreFocusElement={pendingPaidTariffSwitch.restoreFocusElement}
          resolveRestoreFocusElement={pendingPaidTariffSwitch.resolveRestoreFocusElement}
          isPending={paidTariffSwitchPending}
          error={paidTariffSwitchError}
          onCancel={() => {
            if (!paidTariffSwitchPending) {
              setPendingPaidTariffSwitch(null);
              setPaidTariffSwitchError(null);
            }
          }}
          onConfirm={confirmPaidTariffSwitch}
        />
      )}

      {!isCreateOpen && activeEditLogicalTariff && (
        <TariffFormLoader
          mode="edit"
          onSubmit={handleEditSubmit}
          onCancel={onCloseForm}
          initialValues={{
            ...activeEditLogicalTariff.currentVersion,
            provider_id: activeEditLogicalTariff.currentVersion?.provider_id ?? activeEditLogicalTariff.providerId,
            name: activeEditLogicalTariff.currentVersion?.name ?? activeEditLogicalTariff.name,
            affiliation: activeEditLogicalTariff.currentVersion?.affiliation,
            notes: activeEditLogicalTariff.currentVersion?.notes,
          }}
        />
      )}

      {isMissingEditTarget && (
        <Slab className="space-y-4 p-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-primary">Tariff is no longer available</h2>
            <p className="text-sm text-secondary">
              The tariff you started editing could not be found. Return to the list and choose an available tariff.
            </p>
          </div>
          <button
            type="button"
            onClick={onCloseForm}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-secondary/10 px-4 py-2 font-bold text-primary transition-all hover:bg-secondary/20"
          >
            Back to tariffs
          </button>
        </Slab>
      )}

      {!isShellOwnedFormVisible && resolvedSurface.kind === 'promotion' && activeSurfaceLogicalTariff && (
        <TemporaryPromotionForm
          versions={activeSurfaceLogicalTariff.versions}
          onSubmit={async (values) => {
            await schedulePromotion?.({
              userId: user?.id ?? '',
              providerId: activeSurfaceLogicalTariff.providerId,
              name: activeSurfaceLogicalTariff.name,
              ...values,
            });
            setSurface({ kind: 'none' });
          }}
          onCancel={() => setSurface({ kind: 'none' })}
        />
      )}

      {!isShellOwnedFormVisible && !hasLogicalTariffs && (
        <Slab className="p-12 text-center">
          <Info className="mx-auto mb-4 h-12 w-12 text-secondary/30" />
          <h2 className="mb-2 text-xl font-bold text-primary">No Tariffs Yet</h2>
          <p className="text-secondary">Your saved tariffs will appear here once you add your first tariff.</p>
        </Slab>
      )}

      {!isShellOwnedFormVisible && (logicalTariffs ?? []).map((logicalTariff) => {
        const providerName = providerNameById.get(logicalTariff.providerId) ?? logicalTariff.providerId;
        const logicalTariffLabel = getLogicalTariffLabel(providerName, logicalTariff.name);
        const upcomingPreviewCopy = logicalTariff.upcomingVisibility.kind === 'preview'
          ? formatUpcomingPreviewCopy(logicalTariff.upcomingVisibility)
          : '';

        return (
          <Slab key={logicalTariff.key} className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-primary">{providerName}</h2>
                {logicalTariff.name && (
                  <p className="text-sm text-secondary">{logicalTariff.name}</p>
                )}
                {logicalTariff.badge?.kind === 'promo' && (
                  <p className="text-sm font-medium text-primary">{logicalTariff.badge.label}</p>
                )}
              </div>
              <div className="flex items-start gap-2 pt-1">
                <button
                  type="button"
                  ref={(element) => {
                    editButtonElementsRef.current[logicalTariff.key] = element;
                  }}
                  onClick={() => onEditTariff(logicalTariff.key)}
                  aria-label={`Edit ${logicalTariffLabel}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-secondary/10 px-4 py-2 font-bold text-primary transition-all hover:bg-secondary/20"
                >
                  Edit
                </button>
                <TariffVersionActionMenu
                  label={logicalTariffLabel}
                  onPromotion={() => setSurface({ kind: 'promotion', key: logicalTariff.key })}
                  onDelete={() => setSurface({ kind: 'delete', key: logicalTariff.key })}
                />
              </div>
            </div>

            <CurrentPricingRows plan={logicalTariff.currentVersion} />

            {logicalTariff.upcomingVisibility.kind === 'indicator' && (
              <p className="w-fit rounded-full bg-accent/10 px-3 py-2 text-xs font-semibold tabular-nums text-accent">
                {logicalTariff.upcomingVisibility.label}
              </p>
            )}

            {logicalTariff.upcomingVisibility.kind === 'preview' && (
              <div className="space-y-3">
                <div className="h-px bg-secondary/20" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold tabular-nums text-secondary">
                    {logicalTariff.upcomingVisibility.label}
                  </p>
                  {upcomingPreviewCopy && (
                    <p className="text-sm tabular-nums text-primary">
                      {upcomingPreviewCopy}
                    </p>
                  )}
                </div>
              </div>
            )}
          </Slab>
        );
      })}

      {!isShellOwnedFormVisible && resolvedSurface.kind === 'delete' && activeSurfaceLogicalTariff && (
        <DeleteLogicalTariffDialog
          logicalTariffLabel={getLogicalTariffLabel(
            providerNameById.get(activeSurfaceLogicalTariff.providerId) ?? activeSurfaceLogicalTariff.providerId,
            activeSurfaceLogicalTariff.name,
          )}
          isDeleting={isDeletePending}
          onCancel={() => setSurface({ kind: 'none' })}
          onConfirm={async () => {
            setIsDeletePending(true);

            try {
              await deleteLogicalTariff?.({
                userId: user?.id ?? '',
                providerId: activeSurfaceLogicalTariff.providerId,
                name: activeSurfaceLogicalTariff.name,
              });
              setSurface({ kind: 'none' });
            } finally {
              setIsDeletePending(false);
            }
          }}
        />
      )}
    </div>
  );
}
