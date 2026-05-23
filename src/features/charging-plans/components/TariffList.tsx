import React, { useState } from 'react';
import { formatCurrency } from '../../../shared/lib';
import { type ChargingPlan } from '../../../infra/db';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { TariffFormLoader } from './TariffFormLoader';
import { Slab } from '../../../shared/ui';

/**
 * Tariffs screen backed by the charging-plan domain.
 */
export const TariffList: React.FC = () => {
  const { chargingPlans, addChargingPlan, removeChargingPlan, isLoading } = useChargingPlans();
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Tariffs</h1>
        {!isFormOpen && (
          <button onClick={() => setIsFormOpen(true)}>
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

      {chargingPlans.map((plan) => (
        <Slab key={plan.id} className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-primary">{plan.plan_name}</h2>
              <p className="text-sm text-secondary uppercase tracking-wider">Tariff</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingPlan(plan);
                  setIsFormOpen(true);
                }}
              >
                Edit
              </button>
              <button onClick={() => removeChargingPlan(plan.id)}>Delete</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Domestic AC</span>
              <span className="tabular-nums font-medium">{plan.prices.domestic.ac == null ? '—' : formatCurrency(plan.prices.domestic.ac)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Domestic DC</span>
              <span className="tabular-nums font-medium">{plan.prices.domestic.dc == null ? '—' : formatCurrency(plan.prices.domestic.dc)}</span>
            </div>
            {plan.prices.roaming?.ac != null && (
              <div className="flex items-center justify-between">
                <span>Roaming AC</span>
                <span className="tabular-nums">{formatCurrency(plan.prices.roaming.ac)}</span>
              </div>
            )}
            {plan.prices.roaming?.dc != null && (
              <div className="flex items-center justify-between">
                <span>Roaming DC</span>
                <span className="tabular-nums">{formatCurrency(plan.prices.roaming.dc)}</span>
              </div>
            )}
            {plan.fees.subscriptionMonthly != null && (
              <div className="flex items-center justify-between">
                <span>Subscription</span>
                <span className="tabular-nums">{formatCurrency(plan.fees.subscriptionMonthly)}</span>
              </div>
            )}
            {plan.fees.activationOneTime != null && (
              <div className="flex items-center justify-between">
                <span>Activation Fee</span>
                <span className="tabular-nums">{formatCurrency(plan.fees.activationOneTime)}</span>
              </div>
            )}
            {plan.fees.sessionFixed != null && (
              <div className="flex items-center justify-between">
                <span>Session Fee</span>
                <span className="tabular-nums">{formatCurrency(plan.fees.sessionFixed)}</span>
              </div>
            )}
            {plan.fees.cardFee != null && (
              <div className="flex items-center justify-between">
                <span>Card Fee</span>
                <span className="tabular-nums">{formatCurrency(plan.fees.cardFee)}</span>
              </div>
            )}
          </div>
        </Slab>
      ))}
    </div>
  );
};
