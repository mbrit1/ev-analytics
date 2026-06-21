import type { ChargingPlan } from './types'

export type LogicalTariffHistoryLabel = 'Current' | 'Scheduled' | 'Promotion' | 'Past' | 'Restored'

export interface LogicalTariffBadge {
  kind: 'promo' | 'upcoming_change'
  date: string
  label: string
}

export const PREVIEW_THRESHOLD_DAYS = 7
export const INDICATOR_THRESHOLD_DAYS = 30

export interface UpcomingTariffChange {
  label: 'Domestic AC' | 'Domestic DC' | 'Roaming AC' | 'Roaming DC' | 'Monthly Base Fee' | 'Session Fee'
  valueCents: number | null
}

export type LogicalTariffUpcomingVisibility =
  | { kind: 'none' }
  | { kind: 'indicator'; effectiveDate: string; label: string }
  | {
      kind: 'preview'
      effectiveDate: string
      label: string
      changes: UpcomingTariffChange[]
    }

export interface LogicalTariffHistoryRow {
  plan: ChargingPlan
  labels: LogicalTariffHistoryLabel[]
  startDate: string
  endDateInclusive: string | null
}

export interface LogicalTariff {
  key: string
  providerId: string
  name: string
  versions: ChargingPlan[]
  currentVersion: ChargingPlan | null
  nextVersion: ChargingPlan | null
  badge?: LogicalTariffBadge
  upcomingVisibility: LogicalTariffUpcomingVisibility
  history: LogicalTariffHistoryRow[]
}

export interface CurrentChargingPlanOptions {
  at: Date
}

const PRICE_STRUCTURE_KEYS = [
  'ac_price_per_kwh',
  'dc_price_per_kwh',
  'roaming_ac_price_per_kwh',
  'roaming_dc_price_per_kwh',
  'monthly_base_fee',
  'session_fee',
] as const

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
})

type ChargingPlanDateValue = Date | string | null | undefined

const coerceChargingPlanDate = (
  value: ChargingPlanDateValue,
  fieldName: string,
): Date | null => {
  if (value == null) {
    return null
  }

  if (value instanceof Date) {
    return value
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid charging plan ${fieldName}: ${value}`)
  }

  return parsed
}

export const hydrateChargingPlanDates = (plan: ChargingPlan): ChargingPlan => ({
  ...plan,
  valid_from: coerceChargingPlanDate(plan.valid_from as ChargingPlanDateValue, 'valid_from')!,
  valid_to: coerceChargingPlanDate(plan.valid_to as ChargingPlanDateValue, 'valid_to'),
  created_at: coerceChargingPlanDate(plan.created_at as ChargingPlanDateValue, 'created_at')!,
  updated_at: coerceChargingPlanDate(plan.updated_at as ChargingPlanDateValue, 'updated_at')!,
  deleted_at: coerceChargingPlanDate(plan.deleted_at as ChargingPlanDateValue, 'deleted_at') ?? undefined,
})

export const normalizeTariffName = (name: string): string => (name ?? '').trim().toLowerCase()

export const getLogicalTariffKey = (plan: Pick<ChargingPlan, 'provider_id' | 'name'>): string =>
  `${plan.provider_id}::${normalizeTariffName(plan.name)}`

export const addUtcDays = (date: Date, days: number): Date => {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export const formatUtcDate = (date: Date): string => {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const parseUtcDateInput = (value: string): Date => new Date(`${value}T00:00:00.000Z`)

const trimTariffName = (name: string): string => (name ?? '').trim()

const sortPlansByStartDate = (plans: ChargingPlan[]): ChargingPlan[] =>
  [...plans].sort((left, right) => left.valid_from.getTime() - right.valid_from.getTime())

const isDeleted = (plan: ChargingPlan): boolean => Boolean(plan.deleted_at)

const samePriceStructure = (left: ChargingPlan, right: ChargingPlan): boolean =>
  PRICE_STRUCTURE_KEYS.every((key) => left[key] === right[key])

const isPromotionAt = (sorted: ChargingPlan[], index: number): boolean => {
  const previous = sorted[index - 1]
  const candidate = sorted[index]
  const restore = sorted[index + 1]

  if (!previous || !candidate?.valid_to || !restore) {
    return false
  }

  return (
    previous.valid_to?.getTime() === candidate.valid_from.getTime()
    && restore.valid_from.getTime() === candidate.valid_to.getTime()
    && samePriceStructure(previous, restore)
  )
}

const getTemporalLabel = (plan: ChargingPlan, today: Date): LogicalTariffHistoryLabel => {
  if (plan.valid_from.getTime() > today.getTime()) {
    return 'Scheduled'
  }

  if (!plan.valid_to || today.getTime() < plan.valid_to.getTime()) {
    return 'Current'
  }

  return 'Past'
}

const formatDisplayDate = (date: Date): string => DATE_FORMATTER.format(date)

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const PRICE_PREVIEW_FIELDS = [
  ['ac_price_per_kwh', 'Domestic AC'],
  ['dc_price_per_kwh', 'Domestic DC'],
  ['roaming_ac_price_per_kwh', 'Roaming AC'],
  ['roaming_dc_price_per_kwh', 'Roaming DC'],
  ['monthly_base_fee', 'Monthly Base Fee'],
  ['session_fee', 'Session Fee'],
] as const

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

const getDaysUntilChange = (effectiveDate: Date, today: Date): number => {
  const msPerDay = 1000 * 60 * 60 * 24

  return Math.ceil(
    (startOfUtcDay(effectiveDate).getTime() - startOfUtcDay(today).getTime()) / msPerDay,
  )
}

const formatLongDisplayDate = (date: Date): string => FULL_DATE_FORMATTER.format(date)

const buildUpcomingChangePreview = (
  currentVersion: ChargingPlan | null,
  nextVersion: ChargingPlan,
): UpcomingTariffChange[] =>
  PRICE_PREVIEW_FIELDS.flatMap(([field, label]) => {
    const currentValue = currentVersion?.[field]
    const nextValue = nextVersion[field]

    if (currentValue === nextValue) {
      return []
    }

    return [{ label, valueCents: nextValue ?? null }]
  })

const buildBadgeForVersion = (
  sorted: ChargingPlan[],
  index: number,
  promotionIndexes: Set<number>,
): LogicalTariffBadge | undefined => {
  const version = sorted[index]

  if (promotionIndexes.has(index) && version.valid_to) {
    const inclusiveEnd = addUtcDays(version.valid_to, -1)

    return {
      kind: 'promo',
      date: formatUtcDate(inclusiveEnd),
      label: `Promo until ${formatDisplayDate(inclusiveEnd)}`,
    }
  }

  return {
    kind: 'upcoming_change',
    date: formatUtcDate(version.valid_from),
    label: `Changes on ${formatDisplayDate(version.valid_from)}`,
  }
}

export const getTariffUpdateVisibility = (
  comparisonVersion: ChargingPlan | null,
  nextVersion: ChargingPlan | null,
  today: Date,
): LogicalTariffUpcomingVisibility => {
  if (!nextVersion) {
    return { kind: 'none' }
  }

  const daysUntilChange = getDaysUntilChange(nextVersion.valid_from, today)

  if (daysUntilChange < 0 || daysUntilChange > INDICATOR_THRESHOLD_DAYS) {
    return { kind: 'none' }
  }

  if (daysUntilChange > PREVIEW_THRESHOLD_DAYS) {
    return {
      kind: 'indicator',
      effectiveDate: formatUtcDate(nextVersion.valid_from),
      label: `Update scheduled · ${formatLongDisplayDate(nextVersion.valid_from)}`,
    }
  }

  if (!comparisonVersion && daysUntilChange === 0) {
    return { kind: 'none' }
  }

  return {
    kind: 'preview',
    effectiveDate: formatUtcDate(nextVersion.valid_from),
    label: `Next Update · ${formatLongDisplayDate(nextVersion.valid_from)}`,
    changes: buildUpcomingChangePreview(comparisonVersion, nextVersion),
  }
}

export const resolveEffectivePlanForDate = (versions: ChargingPlan[], at: Date): ChargingPlan | null => {
  const sorted = sortPlansByStartDate(
    versions
      .map(hydrateChargingPlanDates)
      .filter((plan) => !isDeleted(plan)),
  )

  return (
    sorted.find((plan) => (
      plan.valid_from.getTime() <= at.getTime()
      && (plan.valid_to == null || at.getTime() < plan.valid_to.getTime())
    )) ?? null
  )
}

export const buildLogicalTariffs = (plans: ChargingPlan[], today: Date): LogicalTariff[] => {
  const groups = new Map<string, ChargingPlan[]>()

  for (const rawPlan of plans) {
    const plan = hydrateChargingPlanDates(rawPlan)

    if (isDeleted(plan)) {
      continue
    }

    const key = getLogicalTariffKey(plan)
    const versions = groups.get(key)

    if (versions) {
      versions.push(plan)
    } else {
      groups.set(key, [plan])
    }
  }

  return [...groups.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, groupPlans]) => {
      const versions = sortPlansByStartDate(groupPlans)
      const currentVersion = resolveEffectivePlanForDate(versions, today)
      const currentIndex = currentVersion ? versions.findIndex((plan) => plan.id === currentVersion.id) : -1
      const nextIndex = versions.findIndex((plan) => plan.valid_from.getTime() > today.getTime())
      const nextVersion = nextIndex >= 0 ? versions[nextIndex] : null
      const sameDayIndex = versions.findIndex((plan) => plan.valid_from.getTime() === today.getTime())
      const hasSameDayPredecessor = sameDayIndex > 0
      const visibilityCandidate =
        sameDayIndex >= 0
          ? hasSameDayPredecessor
            ? versions[sameDayIndex]
            : nextVersion
          : nextVersion
      const comparisonVersion =
        visibilityCandidate && visibilityCandidate.valid_from.getTime() === today.getTime()
          ? (versions[sameDayIndex - 1] ?? null)
          : currentVersion
      const promotionIndexes = new Set<number>()
      const restorationIndexes = new Set<number>()

      versions.forEach((_, index) => {
        if (isPromotionAt(versions, index)) {
          promotionIndexes.add(index)
          restorationIndexes.add(index + 1)
        }
      })

      const history = versions.map((plan, index): LogicalTariffHistoryRow => {
        const labels: LogicalTariffHistoryLabel[] = []

        if (promotionIndexes.has(index)) {
          labels.push('Promotion')
        } else if (restorationIndexes.has(index)) {
          labels.push('Restored')
        }

        labels.push(getTemporalLabel(plan, today))

        return {
          plan,
          labels,
          startDate: formatUtcDate(plan.valid_from),
          endDateInclusive: plan.valid_to ? formatUtcDate(addUtcDays(plan.valid_to, -1)) : null,
        }
      })

      const badge =
        currentIndex >= 0 && promotionIndexes.has(currentIndex)
          ? buildBadgeForVersion(versions, currentIndex, promotionIndexes)
          : nextIndex >= 0
            ? buildBadgeForVersion(versions, nextIndex, promotionIndexes)
            : undefined
      const upcomingVisibility = getTariffUpdateVisibility(comparisonVersion, visibilityCandidate, today)

      return {
        key,
        providerId: versions[0].provider_id,
        name: trimTariffName(versions[0].name),
        versions,
        currentVersion,
        nextVersion,
        upcomingVisibility,
        ...(badge ? { badge } : {}),
        history,
      }
    })
}

export const buildCurrentChargingPlans = (
  plans: ChargingPlan[],
  options: CurrentChargingPlanOptions,
): ChargingPlan[] =>
  buildLogicalTariffs(plans, options.at)
    .flatMap((logicalTariff) => (logicalTariff.currentVersion ? [logicalTariff.currentVersion] : []))
    .sort((left, right) => {
      const providerCompare = left.provider_id.localeCompare(right.provider_id)
      if (providerCompare !== 0) {
        return providerCompare
      }

      const nameCompare = trimTariffName(left.name).localeCompare(trimTariffName(right.name))
      if (nameCompare !== 0) {
        return nameCompare
      }

      return left.valid_from.getTime() - right.valid_from.getTime()
    })
