import { formatCtPerKwh } from '../../../shared/lib'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { AnalyticsInfoDisclosure } from './AnalyticsInfoDisclosure'

const OVERALL_PRICE_EXPLANATION = 'Overall Price divides included spend by provider-billed energy across all recorded sessions. Fixed tariff fees are included only for months in which that tariff was used. The current month is calculated through today. Battery-added energy is not included.'

/** Props for the adaptive Overall Price calculation disclosure. */
export interface OverallPriceInfoDisclosureProps {
  /** Existing Analytics composition mode selects a popover or bottom sheet. */
  layoutMode: AnalyticsLayoutMode
  /** Ready calculation rate retained at disclosure precision. */
  overallPriceCtPerKwh?: number
}

/** Explains the lifetime Overall Price calculation without leaving Analytics. */
export function OverallPriceInfoDisclosure({ layoutMode, overallPriceCtPerKwh }: OverallPriceInfoDisclosureProps) {
  const additionalContent = overallPriceCtPerKwh === undefined
    ? undefined
    : <p className="mt-2">Higher-precision price: {formatCtPerKwh(overallPriceCtPerKwh, 'de-DE')}</p>

  return (
    <AnalyticsInfoDisclosure
      layoutMode={layoutMode}
      heading="How Overall Price is calculated"
      explanation={OVERALL_PRICE_EXPLANATION}
      closeLabel="Close Overall Price information"
      dismissLabel="Dismiss Overall Price information"
      triggerKey="overall-price"
      additionalContent={additionalContent}
    />
  )
}
