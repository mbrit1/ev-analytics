import { Slab } from '../../../shared/ui'
import {
  formatCtPerKwh,
  formatCurrency,
  formatKwh,
  formatMonthLabel,
} from '../../../shared/lib'
import type {
  OverallChargingPriceResult,
  TariffConflict,
} from '../model/overallChargingPrice'
import { OverallPriceInfoDisclosure } from './OverallPriceInfoDisclosure'

/** Props for the presentational lifetime Overall Price Floating Slab. */
export interface OverallPriceSlabProps {
  /** Complete calculation state supplied by the Analytics query composition. */
  result: OverallChargingPriceResult
  /** Prevents a previous calculation result from being shown while refreshing. */
  isLoading?: boolean
  /** Opens the established charging-session entry flow. */
  onAddSession: () => void
  /** Opens the established tariff-management flow for an overlap conflict. */
  onReviewTariffs: () => void
}

function formatConflictMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return formatMonthLabel(year, monthNumber - 1)
}

function formatConflictDescription(conflict: TariffConflict): string {
  const [firstTariff, secondTariff] = conflict.tariffNames
  const providerQualifier = firstTariff === secondTariff
    ? ` for provider ${conflict.providerId}`
    : ''

  return `Tariff dates overlap for ${firstTariff} and ${secondTariff}${providerQualifier} in ${formatConflictMonth(conflict.month)}.`
}

/** Renders each trustworthy calculation state without deriving or fetching data. */
export function OverallPriceSlab({
  result,
  isLoading = false,
  onAddSession,
  onReviewTariffs,
}: OverallPriceSlabProps) {
  const slabClasses = 'mx-auto w-full space-y-4 p-5 md:space-y-5 md:p-8 min-[900px]:!max-w-[760px] min-[900px]:space-y-7 min-[900px]:!rounded-[32px] min-[900px]:!p-12 min-[900px]:!px-13'

  return (
    <Slab padding="none" className={slabClasses} aria-busy={isLoading}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-secondary md:text-sm md:normal-case md:tracking-normal">
          Overall price
        </h2>
        <OverallPriceInfoDisclosure />
      </div>
      {isLoading ? (
        <div role="status" className="h-12 w-40 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none">
          <span className="sr-only">Loading Overall Price</span>
        </div>
      ) : result.status === 'ready' ? (
        <div className="space-y-6 min-[900px]:space-y-8">
          <div className="space-y-3 min-[900px]:space-y-4">
            <p
              className="analytics-metric-value whitespace-nowrap text-[2.75rem] font-bold leading-none tracking-tight text-primary tabular-nums md:text-[3.5rem] min-[900px]:text-[clamp(4rem,5vw,5.25rem)] min-[900px]:font-extrabold min-[900px]:leading-[0.95] min-[900px]:tracking-[-0.055em]"
              aria-label={`Overall price: ${formatCtPerKwh(result.overallPriceCtPerKwh, 'de-DE').replace('ct/kWh', 'cents per kilowatt-hour')}`}
            >
              {formatCtPerKwh(result.overallPriceCtPerKwh, 'de-DE')}
            </p>
            <p className="text-sm leading-5 text-secondary md:text-base md:leading-6">
              Effective price including applicable fixed costs
            </p>
          </div>
          <div className="grid gap-5 border-t border-slab-border/70 pt-5 min-[900px]:grid-cols-2 min-[900px]:gap-8 min-[900px]:pt-8">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-secondary md:text-[0.9375rem]">
                Billed energy
              </h3>
              <p
                className="analytics-metric-value inline-flex items-baseline gap-1 whitespace-nowrap text-[2rem] font-bold leading-none tracking-tight text-primary tabular-nums md:text-[2.5rem] min-[900px]:text-[clamp(2.625rem,3.6vw,3.5rem)] min-[900px]:font-extrabold min-[900px]:tracking-[-0.045em]"
                aria-label={`Billed energy: ${formatKwh(result.billedEnergyKwh)} kilowatt-hours`}
              >
                {formatKwh(result.billedEnergyKwh)} <span className="text-lg leading-none md:text-xl">kWh</span>
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-secondary md:text-[0.9375rem]">
                Included spend
              </h3>
              <p
                className="analytics-metric-value whitespace-nowrap text-[2rem] font-bold leading-none tracking-tight text-primary tabular-nums md:text-[2.5rem] min-[900px]:text-[clamp(2.625rem,3.6vw,3.5rem)] min-[900px]:font-extrabold min-[900px]:tracking-[-0.045em]"
                aria-label={`Included spend: ${formatCurrency(result.includedSpendCents)}`}
              >
                {formatCurrency(result.includedSpendCents)}
              </p>
            </div>
          </div>
        </div>
      ) : result.status === 'empty' ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-lg font-semibold text-primary">No price available</p>
            <p className="text-sm leading-5 text-secondary">
              Add a charging session to calculate your overall energy price.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddSession}
            className="min-h-[44px] rounded-xl bg-accent px-4 py-2 font-bold text-white shadow-md shadow-accent/20 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
          >
            Add Session
          </button>
        </div>
      ) : result.reason === 'overlapping_paid_tariffs' ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-lg font-semibold text-primary">Overall price unavailable</p>
            <p className="text-sm leading-5 text-secondary">
              {formatConflictDescription(result.conflicts[0])}
            </p>
            {result.conflicts.length > 1 && (
              <p className="text-sm font-semibold leading-5 text-secondary">
                and {result.conflicts.length - 1} more
              </p>
            )}
            <p className="text-sm leading-5 text-secondary">
              Update their active dates to calculate Overall Price.
            </p>
          </div>
          <button
            type="button"
            onClick={onReviewTariffs}
            className="min-h-[44px] rounded-xl bg-accent px-4 py-2 font-bold text-white shadow-md shadow-accent/20 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
          >
            Review tariffs
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-lg font-semibold text-primary">Overall price unavailable</p>
          <p className="text-sm leading-5 text-secondary">
            {result.reason === 'invalid_billed_energy'
              ? 'One or more charging sessions has invalid provider-billed energy.'
              : 'Tariff history for one or more charging sessions is incomplete.'}
          </p>
        </div>
      )}
    </Slab>
  )
}
