import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Plus } from 'lucide-react';
import { formatCurrency } from '../../../shared/lib';
import { Slab } from '../../../shared/ui';
import { useAuth } from '../../auth';
import type { ChargingPlan, Provider } from '../../../infra/db';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useUtcToday } from '../hooks/useUtcToday';
import { useProviders } from '../hooks/useProviders';
import {
  getLogicalTariffKey,
  type LogicalTariff,
  type LogicalTariffUpcomingVisibility,
} from '../model/logicalTariffs';
import { DeleteLogicalTariffDialog } from './DeleteLogicalTariffDialog';
import type { TariffFormSubmit } from './TariffForm';
import { TariffFormLoader } from './TariffFormLoader';
import { TariffVersionActionMenu } from './TariffVersionActionMenu';
import { TemporaryPromotionForm } from './TemporaryPromotionForm';
import { PaidTariffSwitchDialog } from './PaidTariffSwitchDialog';
import { RetireLogicalTariffDialog } from './RetireLogicalTariffDialog';
import { PaidTariffOverlapError, type RetirementVersionSnapshot } from '../services/planService';

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
  | { kind: 'delete'; key: string }
  | { kind: 'retire'; key: string };

interface PendingPaidTariffSwitch {
  candidate: ChargingPlan;
  incumbent: ChargingPlan;
  providerName: string;
  restoreFocusElement: HTMLElement | null;
  resolveRestoreFocusElement: () => HTMLElement | null;
}

interface RetiredTariffCloneDraft {
  initialValues: Partial<ChargingPlan>;
  restoreFocusKey: string;
}

interface PendingTariffRetirement {
  providerId: string;
  name: string;
  logicalTariffLabel: string;
  retirementDate: Date;
  versionSnapshot: readonly RetirementVersionSnapshot[];
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

function buildRetiredTariffCloneDefaults(logicalTariff: LogicalTariff): Partial<ChargingPlan> | null {
  const finalVersion = logicalTariff.lifecycle.finalEffectiveVersion;
  if (!finalVersion) return null;

  const initialValues: Partial<ChargingPlan> = {
    provider_id: logicalTariff.providerId,
    name: logicalTariff.name,
    monthly_base_fee: finalVersion.monthly_base_fee,
    session_fee: finalVersion.session_fee,
  };

  if (finalVersion.affiliation != null) initialValues.affiliation = finalVersion.affiliation;
  if (finalVersion.notes != null) initialValues.notes = finalVersion.notes;
  if (finalVersion.ac_price_per_kwh != null) initialValues.ac_price_per_kwh = finalVersion.ac_price_per_kwh;
  if (finalVersion.dc_price_per_kwh != null) initialValues.dc_price_per_kwh = finalVersion.dc_price_per_kwh;
  if (finalVersion.roaming_ac_price_per_kwh != null) {
    initialValues.roaming_ac_price_per_kwh = finalVersion.roaming_ac_price_per_kwh;
  }
  if (finalVersion.roaming_dc_price_per_kwh != null) {
    initialValues.roaming_dc_price_per_kwh = finalVersion.roaming_dc_price_per_kwh;
  }

  return initialValues;
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
    retireLogicalTariff,
    switchActivePaidTariff,
  } = useChargingPlans();
  const { providers } = useProviders();
  const { user } = useAuth();
  const utcToday = useUtcToday();
  const [surface, setSurface] = useState<TariffSurface>({ kind: 'none' });
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [isRetirementPending, setIsRetirementPending] = useState(false);
  const [retirementError, setRetirementError] = useState<string | null>(null);
  const [retirementRestoreFocusElement, setRetirementRestoreFocusElement] = useState<HTMLElement | null>(null);
  const [pendingTariffRetirement, setPendingTariffRetirement] = useState<PendingTariffRetirement | null>(null);
  const [isRetiredTariffsOpen, setIsRetiredTariffsOpen] = useState(false);
  const [retiredTariffCloneDraft, setRetiredTariffCloneDraft] = useState<RetiredTariffCloneDraft | null>(null);
  const [retiredCloneRestoreFocusKey, setRetiredCloneRestoreFocusKey] = useState<string | null>(null);
  const [pendingPaidTariffSwitch, setPendingPaidTariffSwitch] = useState<PendingPaidTariffSwitch | null>(null);
  const [paidTariffSwitchPending, setPaidTariffSwitchPending] = useState(false);
  const [paidTariffSwitchError, setPaidTariffSwitchError] = useState<string | null>(null);
  const editButtonElementsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const retiredCreateButtonElementsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const createTariffFormRef = useRef<HTMLDivElement>(null);

  const providerNameById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const logicalTariffsByKey = useMemo(
    () => new Map((logicalTariffs ?? []).map((logicalTariff) => [logicalTariff.key, logicalTariff])),
    [logicalTariffs],
  );
  const resolvedSurface: TariffSurface = surface.kind !== 'none'
    && surface.kind !== 'retire'
    && !logicalTariffsByKey.has(surface.key)
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
  const mainLogicalTariffs = (logicalTariffs ?? []).filter((logicalTariff) => logicalTariff.lifecycle.kind !== 'retired');
  const retiredLogicalTariffs = (logicalTariffs ?? []).filter((logicalTariff) => logicalTariff.lifecycle.kind === 'retired');
  const isMissingEditTarget = tariffFormState.mode === 'edit' && activeEditLogicalTariff == null;

  const resolveTariffActionTrigger = (logicalTariffLabel: string): HTMLElement | null => (
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === `Tariff actions for ${logicalTariffLabel}`,
    ) ?? null
  );

  const closeRetirementDialog = () => {
    if (isRetirementPending) return;
    setSurface({ kind: 'none' });
    setRetirementError(null);
    setRetirementRestoreFocusElement(null);
    setPendingTariffRetirement(null);
  };

  const confirmRetirement = async () => {
    if (!pendingTariffRetirement || isRetirementPending) return;

    setIsRetirementPending(true);
    setRetirementError(null);
    try {
      await retireLogicalTariff({
        userId: user?.id ?? '',
        providerId: pendingTariffRetirement.providerId,
        name: pendingTariffRetirement.name,
        retirementDate: pendingTariffRetirement.retirementDate,
        versionSnapshot: pendingTariffRetirement.versionSnapshot,
      });
      setSurface({ kind: 'none' });
      setRetirementRestoreFocusElement(null);
      setPendingTariffRetirement(null);
    } catch (error) {
      setRetirementError(error instanceof Error ? error.message : 'Could not retire tariff.');
    } finally {
      setIsRetirementPending(false);
    }
  };

  useEffect(() => {
    onFormOpenChange?.(isShellOwnedFormVisible);
  }, [isShellOwnedFormVisible, onFormOpenChange]);

  useEffect(() => {
    if (isShellOwnedFormVisible || !retiredCloneRestoreFocusKey) return;

    const restoreFocusElement = retiredCreateButtonElementsRef.current[retiredCloneRestoreFocusKey];
    if (!restoreFocusElement) return;
    restoreFocusElement.focus();
    setRetiredCloneRestoreFocusKey(null);
  }, [isShellOwnedFormVisible, retiredCloneRestoreFocusKey]);

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
    const authenticatedUserId = user?.id;
    if (!authenticatedUserId) {
      throw new Error('You must be signed in to save a tariff.');
    }
    const candidate = { ...submission.plan, user_id: authenticatedUserId };
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
          user_id: authenticatedUserId,
          created_at: now,
          updated_at: now,
        };
        await addProviderWithFirstTariff({ provider, plan: candidate });
        setRetiredTariffCloneDraft(null);
        onSaveComplete(getLogicalTariffKey({ provider_id: candidate.provider_id, name: candidate.name }));
        return;
      }
      await addChargingPlan(candidate);
      setRetiredTariffCloneDraft(null);
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
      setRetiredTariffCloneDraft(null);
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
            onClick={() => {
              setRetiredTariffCloneDraft(null);
              setRetiredCloneRestoreFocusKey(null);
              onCreateTariff();
            }}
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
            onCancel={() => {
              if (retiredTariffCloneDraft) {
                setRetiredCloneRestoreFocusKey(retiredTariffCloneDraft.restoreFocusKey);
                setRetiredTariffCloneDraft(null);
              }
              onCloseForm();
            }}
            initialValues={retiredTariffCloneDraft?.initialValues}
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

      {!isShellOwnedFormVisible && resolvedSurface.kind === 'retire' && pendingTariffRetirement && (
        <RetireLogicalTariffDialog
          logicalTariffLabel={pendingTariffRetirement.logicalTariffLabel}
          finalActiveDate={pendingTariffRetirement.retirementDate}
          restoreFocusElement={retirementRestoreFocusElement}
          isPending={isRetirementPending}
          error={retirementError}
          onCancel={closeRetirementDialog}
          onConfirm={confirmRetirement}
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

      {!isShellOwnedFormVisible && mainLogicalTariffs.map((logicalTariff) => {
        const providerName = providerNameById.get(logicalTariff.providerId) ?? logicalTariff.providerId;
        const logicalTariffLabel = getLogicalTariffLabel(providerName, logicalTariff.name);
        const upcomingPreviewCopy = logicalTariff.upcomingVisibility.kind === 'preview'
          ? formatUpcomingPreviewCopy(logicalTariff.upcomingVisibility)
          : '';
        const canRetire = logicalTariff.currentVersion != null
          && logicalTariff.lifecycle.kind === 'current';

        return (
          <Slab key={logicalTariff.key} className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-primary">{providerName}</h2>
                {logicalTariff.name && (
                  <p className="text-sm text-secondary">{logicalTariff.name}</p>
                )}
                {logicalTariff.lifecycle.kind === 'ending_today' && (
                  <p className="text-sm font-medium text-primary">Ends today</p>
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
                  onRetire={canRetire ? () => {
                    const versionSnapshot = logicalTariff.versions
                      .filter((version) => !version.deleted_at)
                      .map((version) => ({
                        id: version.id,
                        updated_at: new Date(version.updated_at.getTime()),
                        valid_from: new Date(version.valid_from.getTime()),
                        valid_to: version.valid_to ? new Date(version.valid_to.getTime()) : null,
                      }));
                    setRetirementError(null);
                    setRetirementRestoreFocusElement(resolveTariffActionTrigger(logicalTariffLabel));
                    setPendingTariffRetirement({
                      providerId: logicalTariff.providerId,
                      name: logicalTariff.name,
                      logicalTariffLabel,
                      retirementDate: new Date(utcToday.getTime()),
                      versionSnapshot,
                    });
                    setSurface({ kind: 'retire', key: logicalTariff.key });
                  } : undefined}
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

      {!isShellOwnedFormVisible && retiredLogicalTariffs.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            aria-expanded={isRetiredTariffsOpen}
            aria-controls="retired-tariffs"
            onClick={() => setIsRetiredTariffsOpen((isOpen) => !isOpen)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-secondary/10 px-4 py-2 text-left font-bold text-primary transition-all hover:bg-secondary/20"
          >
            <span>Retired tariffs ({retiredLogicalTariffs.length})</span>
            <span aria-hidden="true">{isRetiredTariffsOpen ? 'Hide' : 'Show'}</span>
          </button>
          {isRetiredTariffsOpen && (
            <section id="retired-tariffs" aria-label="Retired tariffs" className="space-y-4">
              {retiredLogicalTariffs.map((logicalTariff) => {
                const providerName = providerNameById.get(logicalTariff.providerId) ?? logicalTariff.providerId;
                const finalVersion = logicalTariff.lifecycle.finalEffectiveVersion;

                return (
                  <Slab key={logicalTariff.key} className="space-y-4 p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <h2 className="text-xl font-semibold text-primary">{providerName}</h2>
                        {logicalTariff.name && (
                          <p className="text-sm text-secondary">{logicalTariff.name}</p>
                        )}
                        {logicalTariff.lifecycle.finalActiveDate && (
                          <p className="text-sm text-secondary">
                            Final active date: {logicalTariff.lifecycle.finalActiveDate}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        ref={(element) => {
                          retiredCreateButtonElementsRef.current[logicalTariff.key] = element;
                        }}
                        onClick={() => {
                          const initialValues = buildRetiredTariffCloneDefaults(logicalTariff);
                          if (!initialValues) return;
                          setRetiredTariffCloneDraft({
                            initialValues,
                            restoreFocusKey: logicalTariff.key,
                          });
                          setRetiredCloneRestoreFocusKey(null);
                          onCreateTariff();
                        }}
                        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-secondary/10 px-4 py-2 font-bold text-primary transition-all hover:bg-secondary/20 sm:w-auto"
                      >
                        Create new from retired
                      </button>
                    </div>
                    <CurrentPricingRows plan={finalVersion} />
                  </Slab>
                );
              })}
            </section>
          )}
        </div>
      )}

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
