import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../../shared/lib';
import { type ChargingPlan } from '../../../infra/db';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { TariffFormLoader } from './TariffFormLoader';
import { Slab } from '../../../shared/ui';

/**
 * Tariffs screen backed by the charging-plan domain.
 */
export const TariffList: React.FC = () => {
  const { chargingPlans, addChargingPlan, removeChargingPlan, isLoading } = useChargingPlans();
  const { providers } = useProviders();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ChargingPlan | undefined>(undefined);

  const handleSubmit = async (plan: ChargingPlan) => {
    await addChargingPlan(plan);
    setIsFormOpen(false);
    setEditingPlan(undefined);
  };

  if (isLoading) {
    return <div>Loading tariffs...</div>;
  }

  const shouldRenderOptionalAmount = (amount: number | undefined): amount is number => amount != null && amount > 0;
  const providerNameById = new Map(providers.map((provider) => [provider.id, provider.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Tariffs</h1>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center px-4 py-2 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-md shadow-accent/20 min-h-[44px]"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Tariff
          </button>
        )}
      </div>

      {isFormOpen && (
        <TariffFormLoader
          onSubmit={handleSubmit}
          onCancel={() => {
            setIsFormOpen(false);
            setEditingPlan(undefined);
          }}
          initialValues={editingPlan}
        />
      )}

      {chargingPlans.map((plan) => {
        const providerName = providerNameById.get(plan.provider_id) ?? plan.provider_id;
        const variantName = (plan.plan_name ?? '').trim();
        const editLabel = variantName.length > 0 ? `Edit ${providerName} ${variantName}` : `Edit ${providerName}`;
        const deleteLabel = variantName.length > 0 ? `Delete ${providerName} ${variantName}` : `Delete ${providerName}`;

        return (
        <Slab key={plan.id} className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-primary">{providerName}</h2>
              {variantName.length > 0 && (
                <p className="text-sm text-secondary">{variantName}</p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setEditingPlan(plan);
                  setIsFormOpen(true);
                }}
                aria-label={editLabel}
                className="inline-flex items-center justify-center px-3 py-2 bg-secondary/10 text-primary font-bold rounded-xl hover:bg-secondary/20 transition-all min-h-[44px] sm:px-4"
              >
                <span className="text-lg leading-none sm:hidden" aria-hidden="true">✎</span>
                <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                onClick={() => removeChargingPlan(plan.id)}
                aria-label={deleteLabel}
                className="inline-flex items-center justify-center px-3 py-2 border border-secondary/20 text-primary font-bold rounded-xl hover:bg-secondary/5 transition-all min-h-[44px] sm:px-4"
              >
                <Trash2 className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          </div>

          <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
              <span>Domestic AC</span>
              <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">{plan.prices.domestic.ac == null ? '—' : formatCurrency(plan.prices.domestic.ac)}</span>
            </div>
            <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
              <span>Domestic DC</span>
              <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">{plan.prices.domestic.dc == null ? '—' : formatCurrency(plan.prices.domestic.dc)}</span>
            </div>
            {shouldRenderOptionalAmount(plan.prices.roaming?.ac) && (
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Roaming AC</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.prices.roaming.ac)}</span>
              </div>
            )}
            {shouldRenderOptionalAmount(plan.prices.roaming?.dc) && (
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Roaming DC</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.prices.roaming.dc)}</span>
              </div>
            )}
            {shouldRenderOptionalAmount(plan.fees.subscriptionMonthly) && (
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Subscription</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.fees.subscriptionMonthly)}</span>
              </div>
            )}
            {shouldRenderOptionalAmount(plan.fees.activationOneTime) && (
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Activation Fee</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.fees.activationOneTime)}</span>
              </div>
            )}
            {shouldRenderOptionalAmount(plan.fees.sessionFixed) && (
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Session Fee</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.fees.sessionFixed)}</span>
              </div>
            )}
            {shouldRenderOptionalAmount(plan.fees.cardFee) && (
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Card Fee</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.fees.cardFee)}</span>
              </div>
            )}
          </div>
        </Slab>
        );
      })}
    </div>
  );
};
