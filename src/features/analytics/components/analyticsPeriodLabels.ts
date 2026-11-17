import type { AnalyticsPeriod } from '../model/analyticsPeriods'

const formatDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Formats the inclusive calendar dates represented by an exclusive-end period. */
export function formatAnalyticsPeriodRange(period: Pick<AnalyticsPeriod, 'startUtc' | 'endUtc'>): string {
  const lastIncluded = new Date(period.endUtc.getTime() - 1)
  const sameYear = period.startUtc.getFullYear() === lastIncluded.getFullYear()
  const start = sameYear
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(period.startUtc)
    : formatDate.format(period.startUtc)
  return `${start} – ${formatDate.format(lastIncluded)}`
}
