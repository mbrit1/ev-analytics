import { X } from 'lucide-react';
import { formatCurrency } from '../../../shared/lib';
import { Slab } from '../../../shared/ui';
import type { ChargingPlan } from '../../../infra/db';
import type { LogicalTariff } from '../model/logicalTariffs';

interface TariffVersionHistorySheetProps {
  logicalTariff: LogicalTariff;
  providerName: string;
  onClose: () => void;
}

interface PriceRow {
  label: string;
  value: number;
}

function buildPriceRows(plan: ChargingPlan): PriceRow[] {
  const rows: PriceRow[] = [];

  if (plan.ac_price_per_kwh != null) {
    rows.push({ label: 'Domestic AC', value: plan.ac_price_per_kwh });
  }

  if (plan.dc_price_per_kwh != null) {
    rows.push({ label: 'Domestic DC', value: plan.dc_price_per_kwh });
  }

  if (plan.roaming_ac_price_per_kwh != null) {
    rows.push({ label: 'Roaming AC', value: plan.roaming_ac_price_per_kwh });
  }

  if (plan.roaming_dc_price_per_kwh != null) {
    rows.push({ label: 'Roaming DC', value: plan.roaming_dc_price_per_kwh });
  }

  rows.push({ label: 'Monthly Base Fee', value: plan.monthly_base_fee });
  rows.push({ label: 'Session Fee', value: plan.session_fee });

  return rows;
}

/**
 * Read-only chronological history for a logical tariff and its effective versions.
 */
export function TariffVersionHistorySheet({
  logicalTariff,
  providerName,
  onClose,
}: TariffVersionHistorySheetProps) {
  const label = logicalTariff.name ? `${providerName} ${logicalTariff.name}` : providerName;

  return (
    <Slab className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-primary">Tariff History</h2>
          <p className="text-sm text-secondary">{label}</p>
        </div>
        <button
          type="button"
          aria-label="Close tariff history"
          onClick={onClose}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-secondary transition-colors hover:bg-secondary/10 hover:text-primary"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4">
        {logicalTariff.history.map((row) => (
          <div key={row.plan.id} className="rounded-2xl border border-secondary/10 bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              {row.labels.map((labelText) => (
                <span
                  key={`${row.plan.id}-${labelText}`}
                  className="rounded-full bg-secondary/10 px-3 py-1 text-xs font-semibold text-primary"
                >
                  {labelText}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm font-medium text-primary">
              {row.startDate} - {row.endDateInclusive ?? 'Ongoing'}
            </p>
            <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
              {buildPriceRows(row.plan).map((priceRow) => (
                <div key={`${row.plan.id}-${priceRow.label}`} className="grid grid-cols-[auto_auto] items-baseline justify-between gap-3">
                  <span className="text-secondary">{priceRow.label}</span>
                  <span className="tabular-nums text-primary">{formatCurrency(priceRow.value)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Slab>
  );
}
