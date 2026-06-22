import { useEffect, useMemo, useState } from 'react';
import { Info, Plus } from 'lucide-react';
import { formatCurrency } from '../../../shared/lib';
import { Slab } from '../../../shared/ui';
import { useAuth } from '../../auth';
import type { ChargingPlan } from '../../../infra/db';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { DeleteLogicalTariffDialog } from './DeleteLogicalTariffDialog';
import { PermanentPriceChangeForm } from './PermanentPriceChangeForm';
import { TariffFormLoader } from './TariffFormLoader';
import { TariffVersionActionMenu } from './TariffVersionActionMenu';
import { TariffVersionHistorySheet } from './TariffVersionHistorySheet';
import { TemporaryPromotionForm } from './TemporaryPromotionForm';

type TariffSurface =
  | { kind: 'none' }
  | { kind: 'details'; key: string }
  | { kind: 'permanent_change'; key: string }
  | { kind: 'promotion'; key: string }
  | { kind: 'history'; key: string }
  | { kind: 'delete'; key: string };

/**
 * Tariffs screen backed by the charging-plan domain.
 */
interface TariffListProps {
  /** Controls whether the create form should open from the parent shell. */
  isCreatingTariff: boolean;
  /** Clears the parent-owned tariff create request when consumed or dismissed. */
  onCreateTariffChange: (isCreatingTariff: boolean) => void;
  /** Emits whether the create/edit form surface is currently open. */
  onFormOpenChange?: (isOpen: boolean) => void;
}

interface CurrentPricingRowsProps {
  plan: ChargingPlan | null;
}

function shouldRenderAmount(amount: number | undefined): amount is number {
  return amount != null;
}

function shouldRenderOptionalAmount(amount: number | undefined): amount is number {
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
      {shouldRenderOptionalAmount(plan?.roaming_ac_price_per_kwh) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Roaming AC</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.roaming_ac_price_per_kwh)}
          </span>
        </div>
      )}
      {shouldRenderOptionalAmount(plan?.roaming_dc_price_per_kwh) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Roaming DC</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.roaming_dc_price_per_kwh)}
          </span>
        </div>
      )}
      {shouldRenderOptionalAmount(plan?.monthly_base_fee) && (
        <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
          <span>Monthly Base Fee</span>
          <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">
            {formatCurrency(plan.monthly_base_fee)}
          </span>
        </div>
      )}
      {shouldRenderOptionalAmount(plan?.session_fee) && (
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

function getLogicalTariffLabel(providerName: string, tariffName: string): string {
  return tariffName ? `${providerName} ${tariffName}` : providerName;
}

/**
 * Tariffs screen backed by the charging-plan domain.
 */
export function TariffList({
  isCreatingTariff,
  onCreateTariffChange,
  onFormOpenChange,
}: TariffListProps) {
  const {
    logicalTariffs,
    addChargingPlan,
    isLoading,
    updateLogicalTariffDetails,
    schedulePermanentChange,
    schedulePromotion,
    deleteLogicalTariff,
  } = useChargingPlans();
  const { providers } = useProviders();
  const { user } = useAuth();
  const [surface, setSurface] = useState<TariffSurface>({ kind: 'none' });
  const [isCreateRequested, setIsCreateRequested] = useState(false);
  const [isDeletePending, setIsDeletePending] = useState(false);

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
  const activeLogicalTariff = resolvedSurface.kind === 'none'
    ? null
    : logicalTariffsByKey.get(resolvedSurface.key) ?? null;
  const isCreateOpen = isCreatingTariff || isCreateRequested;
  const isFormVisible = isCreateOpen || ['details', 'permanent_change', 'promotion'].includes(resolvedSurface.kind);
  const hasLogicalTariffs = (logicalTariffs ?? []).length > 0;

  useEffect(() => {
    onFormOpenChange?.(isFormVisible);
  }, [isFormVisible, onFormOpenChange]);

  const closeCreate = () => {
    setIsCreateRequested(false);
    onCreateTariffChange(false);
  };

  const closeSurface = () => {
    setSurface({ kind: 'none' });
    setIsDeletePending(false);
  };

  const handleCreateSubmit = async (plan: ChargingPlan) => {
    await addChargingPlan({
      ...plan,
      user_id: user?.id ?? plan.user_id,
    });
    closeCreate();
  };

  if (isLoading) {
    return <div>Loading tariffs...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Tariffs</h1>
        {!isFormVisible && (
          <button
            type="button"
            onClick={() => setIsCreateRequested(true)}
            className="hidden min-h-[44px] items-center rounded-xl bg-accent px-4 py-2 font-bold text-white shadow-md shadow-accent/20 transition-all hover:opacity-90 md:flex"
          >
            <Plus className="mr-2 h-5 w-5" />
            Add Tariff
          </button>
        )}
      </div>

      {isCreateOpen && (
        <TariffFormLoader
          mode="create"
          onSubmit={handleCreateSubmit}
          onCancel={closeCreate}
        />
      )}

      {!isCreateOpen && resolvedSurface.kind === 'details' && activeLogicalTariff && (
        <TariffFormLoader
          mode="details"
          onSubmit={async (values) => {
            await updateLogicalTariffDetails?.({
              userId: user?.id ?? '',
              providerId: activeLogicalTariff.providerId,
              name: activeLogicalTariff.name,
              ...values,
            });
            closeSurface();
          }}
          onCancel={closeSurface}
          initialValues={{
            provider_id: activeLogicalTariff.providerId,
            name: activeLogicalTariff.name,
            affiliation: activeLogicalTariff.currentVersion?.affiliation,
            notes: activeLogicalTariff.currentVersion?.notes,
          }}
        />
      )}

      {!isCreateOpen && resolvedSurface.kind === 'permanent_change' && activeLogicalTariff && (
        <PermanentPriceChangeForm
          versions={activeLogicalTariff.versions}
          onSubmit={async (values) => {
            await schedulePermanentChange?.({
              userId: user?.id ?? '',
              providerId: activeLogicalTariff.providerId,
              name: activeLogicalTariff.name,
              ...values,
            });
            closeSurface();
          }}
          onCancel={closeSurface}
        />
      )}

      {!isCreateOpen && resolvedSurface.kind === 'promotion' && activeLogicalTariff && (
        <TemporaryPromotionForm
          versions={activeLogicalTariff.versions}
          onSubmit={async (values) => {
            await schedulePromotion?.({
              userId: user?.id ?? '',
              providerId: activeLogicalTariff.providerId,
              name: activeLogicalTariff.name,
              ...values,
            });
            closeSurface();
          }}
          onCancel={closeSurface}
        />
      )}

      {!isCreateOpen && resolvedSurface.kind === 'history' && activeLogicalTariff && (
        <TariffVersionHistorySheet
          logicalTariff={activeLogicalTariff}
          providerName={providerNameById.get(activeLogicalTariff.providerId) ?? activeLogicalTariff.providerId}
          onClose={closeSurface}
        />
      )}

      {!isFormVisible && !hasLogicalTariffs && (
        <Slab className="p-12 text-center">
          <Info className="mx-auto mb-4 h-12 w-12 text-secondary/30" />
          <h2 className="mb-2 text-xl font-bold text-primary">No Tariffs Yet</h2>
          <p className="text-secondary">Your saved tariffs will appear here once you add your first tariff.</p>
        </Slab>
      )}

      {(logicalTariffs ?? []).map((logicalTariff) => {
        const providerName = providerNameById.get(logicalTariff.providerId) ?? logicalTariff.providerId;
        const logicalTariffLabel = getLogicalTariffLabel(providerName, logicalTariff.name);

        return (
          <Slab key={logicalTariff.key} className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-primary">{providerName}</h2>
                {logicalTariff.name && (
                  <p className="text-sm text-secondary">{logicalTariff.name}</p>
                )}
                {logicalTariff.badge && (
                  <p className="text-sm font-medium text-primary">{logicalTariff.badge.label}</p>
                )}
              </div>
              <div className="flex items-start gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSurface({ kind: 'details', key: logicalTariff.key })}
                  aria-label={`Edit ${logicalTariffLabel}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-secondary/10 px-4 py-2 font-bold text-primary transition-all hover:bg-secondary/20"
                >
                  Edit
                </button>
                <TariffVersionActionMenu
                  label={logicalTariffLabel}
                  onEditDetails={() => setSurface({ kind: 'details', key: logicalTariff.key })}
                  onPermanentChange={() => setSurface({ kind: 'permanent_change', key: logicalTariff.key })}
                  onPromotion={() => setSurface({ kind: 'promotion', key: logicalTariff.key })}
                  onDelete={() => setSurface({ kind: 'delete', key: logicalTariff.key })}
                />
              </div>
            </div>

            <CurrentPricingRows plan={logicalTariff.currentVersion} />

            <button
              type="button"
              onClick={() => setSurface({ kind: 'history', key: logicalTariff.key })}
              className="min-h-[44px] text-sm font-medium text-secondary transition-colors hover:text-primary"
            >
              View history for {logicalTariffLabel}
            </button>
          </Slab>
        );
      })}

      {!isCreateOpen && resolvedSurface.kind === 'delete' && activeLogicalTariff && (
        <DeleteLogicalTariffDialog
          logicalTariffLabel={getLogicalTariffLabel(
            providerNameById.get(activeLogicalTariff.providerId) ?? activeLogicalTariff.providerId,
            activeLogicalTariff.name,
          )}
          isDeleting={isDeletePending}
          onCancel={closeSurface}
          onConfirm={async () => {
            setIsDeletePending(true);

            try {
              await deleteLogicalTariff?.({
                userId: user?.id ?? '',
                providerId: activeLogicalTariff.providerId,
                name: activeLogicalTariff.name,
              });
              closeSurface();
            } finally {
              setIsDeletePending(false);
            }
          }}
        />
      )}
    </div>
  );
}
