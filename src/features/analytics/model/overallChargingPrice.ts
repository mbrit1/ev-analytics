import {
  addUtcDays,
  getLogicalTariffKey,
  normalizeTariffName,
  type ChargingPlan,
} from '../../charging-plans'
import type { ChargingSession } from '../../charging-sessions'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const CANONICAL_LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

interface LogicalTariffTimeline {
  providerId: string
  normalizedName: string
  displayName: string
  versions: ChargingPlan[]
}

interface ActiveInterval {
  start: number
  end: number
  daysInMonth: number
}

interface RationalCents {
  numerator: bigint
  denominator: bigint
}

/** Canonical `YYYY-MM-DD` date in the user's local calendar. */
export type LocalDateKey = string

/** Canonical `YYYY-MM` month in the user's local calendar. */
export type LocalMonthKey = string

/** Diagnostic for two qualifying paid tariffs whose intervals overlap. */
export interface TariffConflict {
  providerId: string
  tariffNames: readonly [string, string]
  month: LocalMonthKey
}

/** Pure input for the lifetime Overall Price calculation. */
export interface OverallChargingPriceInput {
  sessions: readonly ChargingSession[]
  chargingPlanVersions: readonly ChargingPlan[]
  asOfLocalDate: LocalDateKey
}

/** Complete, trustworthy result of the lifetime Overall Price calculation. */
export type OverallChargingPriceResult =
  | { status: 'empty' }
  | {
      status: 'ready'
      sessionCount: number
      billedEnergyKwh: number
      sessionSpendCents: number
      fixedCostCents: number
      includedSpendCents: number
      overallPriceCtPerKwh: number
    }
  | {
      status: 'unavailable'
      reason: 'invalid_billed_energy'
    }
  | {
      status: 'unavailable'
      reason: 'missing_tariff_history'
    }
  | {
      status: 'unavailable'
      reason: 'overlapping_paid_tariffs'
      conflicts: readonly [TariffConflict, ...TariffConflict[]]
    }

function createUtcCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month, day)
  return date
}

function parseCanonicalLocalDate(value: string): Date {
  const match = CANONICAL_LOCAL_DATE_PATTERN.exec(value)
  if (!match) {
    throw new RangeError('asOfLocalDate must be a real date in YYYY-MM-DD format')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = createUtcCalendarDate(year, month - 1, day)

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new RangeError('asOfLocalDate must be a real date in YYYY-MM-DD format')
  }

  return parsed
}

function toUtcCalendarDate(value: Date): Date {
  return createUtcCalendarDate(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  )
}

function formatLocalMonthKey(value: Date): LocalMonthKey {
  const year = `${value.getFullYear()}`.padStart(4, '0')
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

function parseLocalMonthKey(value: LocalMonthKey): {
  start: Date
  end: Date
  days: number
} {
  const [year, month] = value.split('-').map(Number)
  const start = createUtcCalendarDate(year, month - 1, 1)
  const end = createUtcCalendarDate(year, month, 1)

  return {
    start,
    end,
    days: (end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY,
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function isPlanSession(
  session: ChargingSession,
): session is Extract<ChargingSession, { session_mode: 'plan' }> {
  return session.session_mode === 'plan'
}

function addQualifiedMonth(
  qualifiedMonths: Map<string, Set<LocalMonthKey>>,
  logicalTariffKey: string,
  month: LocalMonthKey,
): void {
  const months = qualifiedMonths.get(logicalTariffKey)
  if (months) {
    months.add(month)
    return
  }

  qualifiedMonths.set(logicalTariffKey, new Set([month]))
}

function getActiveInterval(
  plan: ChargingPlan,
  month: LocalMonthKey,
  asOfTomorrow: Date,
): ActiveInterval | null {
  const period = parseLocalMonthKey(month)
  const horizon = new Date(Math.min(period.end.getTime(), asOfTomorrow.getTime()))
  const planStart = toUtcCalendarDate(plan.valid_from)
  const planEnd = plan.valid_to ? toUtcCalendarDate(plan.valid_to) : horizon
  const intersectionStart = Math.max(period.start.getTime(), planStart.getTime())
  const intersectionEnd = Math.min(horizon.getTime(), planEnd.getTime())

  if (intersectionEnd <= intersectionStart) {
    return null
  }

  return {
    start: intersectionStart,
    end: intersectionEnd,
    daysInMonth: period.days,
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let divisor = right
  let remainder = left

  while (divisor !== 0n) {
    const next = remainder % divisor
    remainder = divisor
    divisor = next
  }

  return remainder < 0n ? -remainder : remainder
}

function addRationalCents(
  total: RationalCents,
  numerator: bigint,
  denominator: bigint,
): RationalCents {
  if (numerator === 0n) {
    return total
  }

  const sharedDenominator = greatestCommonDivisor(total.denominator, denominator)
  const totalMultiplier = denominator / sharedDenominator
  const additionMultiplier = total.denominator / sharedDenominator
  const combinedNumerator = (
    total.numerator * totalMultiplier
    + numerator * additionMultiplier
  )
  const combinedDenominator = total.denominator * totalMultiplier
  const reduction = greatestCommonDivisor(combinedNumerator, combinedDenominator)

  return {
    numerator: combinedNumerator / reduction,
    denominator: combinedDenominator / reduction,
  }
}

function addVersionContribution(
  total: RationalCents,
  plan: ChargingPlan,
  month: LocalMonthKey,
  asOfTomorrow: Date,
): RationalCents {
  const interval = getActiveInterval(plan, month, asOfTomorrow)
  if (!interval || plan.monthly_base_fee === 0) {
    return total
  }

  const activeDays = (interval.end - interval.start) / MILLISECONDS_PER_DAY
  return addRationalCents(
    total,
    BigInt(plan.monthly_base_fee) * BigInt(activeDays),
    BigInt(interval.daysInMonth),
  )
}

function roundNonNegativeRationalCents(total: RationalCents): number {
  const wholeCents = total.numerator / total.denominator
  const remainder = total.numerator % total.denominator
  const rounded = remainder * 2n >= total.denominator
    ? wholeCents + 1n
    : wholeCents

  return Number(rounded)
}

function createLogicalTariffTimelines(
  plans: readonly ChargingPlan[],
): Map<string, LogicalTariffTimeline> {
  const timelines = new Map<string, LogicalTariffTimeline>()

  for (const plan of plans) {
    const key = getLogicalTariffKey(plan)
    const existing = timelines.get(key)
    if (existing) {
      existing.versions.push(plan)
      continue
    }

    timelines.set(key, {
      providerId: plan.provider_id,
      normalizedName: normalizeTariffName(plan.name),
      displayName: plan.name.trim(),
      versions: [plan],
    })
  }

  for (const timeline of timelines.values()) {
    timeline.versions.sort((left, right) => (
      left.valid_from.getTime() - right.valid_from.getTime()
      || compareStrings(left.id, right.id)
    ))
    timeline.displayName = timeline.versions[0]?.name.trim() ?? timeline.normalizedName
  }

  return timelines
}

function haveOverlappingPaidIntervals(
  left: LogicalTariffTimeline,
  right: LogicalTariffTimeline,
  month: LocalMonthKey,
  asOfTomorrow: Date,
): boolean {
  for (const leftVersion of left.versions) {
    if (leftVersion.monthly_base_fee <= 0) {
      continue
    }

    const leftInterval = getActiveInterval(leftVersion, month, asOfTomorrow)
    if (!leftInterval) {
      continue
    }

    for (const rightVersion of right.versions) {
      if (rightVersion.monthly_base_fee <= 0) {
        continue
      }

      const rightInterval = getActiveInterval(rightVersion, month, asOfTomorrow)
      if (
        rightInterval
        && Math.max(leftInterval.start, rightInterval.start)
          < Math.min(leftInterval.end, rightInterval.end)
      ) {
        return true
      }
    }
  }

  return false
}

function findTariffConflicts(
  qualifiedMonths: ReadonlyMap<string, ReadonlySet<LocalMonthKey>>,
  timelines: ReadonlyMap<string, LogicalTariffTimeline>,
  asOfTomorrow: Date,
): TariffConflict[] {
  const allMonths = new Set<LocalMonthKey>()
  for (const months of qualifiedMonths.values()) {
    for (const month of months) {
      allMonths.add(month)
    }
  }

  const conflicts: TariffConflict[] = []
  for (const month of [...allMonths].sort(compareStrings)) {
    const qualifyingTimelines = [...qualifiedMonths]
      .filter(([, months]) => months.has(month))
      .map(([key]) => timelines.get(key))
      .filter((timeline): timeline is LogicalTariffTimeline => Boolean(timeline))

    const providers = new Map<string, LogicalTariffTimeline[]>()
    for (const timeline of qualifyingTimelines) {
      const providerTimelines = providers.get(timeline.providerId)
      if (providerTimelines) {
        providerTimelines.push(timeline)
      } else {
        providers.set(timeline.providerId, [timeline])
      }
    }

    for (const providerId of [...providers.keys()].sort(compareStrings)) {
      const providerTimelines = providers.get(providerId)!
      providerTimelines.sort((left, right) => compareStrings(
        left.normalizedName,
        right.normalizedName,
      ))

      for (let leftIndex = 0; leftIndex < providerTimelines.length; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < providerTimelines.length;
          rightIndex += 1
        ) {
          const left = providerTimelines[leftIndex]
          const right = providerTimelines[rightIndex]
          if (haveOverlappingPaidIntervals(left, right, month, asOfTomorrow)) {
            conflicts.push({
              providerId,
              tariffNames: [left.displayName, right.displayName],
              month,
            })
          }
        }
      }
    }
  }

  return conflicts
}

/**
 * Calculates the weighted lifetime charging price from trusted local snapshots.
 *
 * Throws `RangeError` when `asOfLocalDate` is not a real canonical local date.
 * Business-data completeness failures are returned as unavailable variants.
 */
export function calculateOverallChargingPrice(
  input: OverallChargingPriceInput,
): OverallChargingPriceResult {
  const asOfLocalDate = parseCanonicalLocalDate(input.asOfLocalDate)
  const activeSessions = input.sessions.filter((session) => !session.deleted_at)

  if (activeSessions.length === 0) {
    return { status: 'empty' }
  }

  if (activeSessions.some(
    (session) => !Number.isFinite(session.kwh_billed) || session.kwh_billed <= 0,
  )) {
    return { status: 'unavailable', reason: 'invalid_billed_energy' }
  }

  const billedEnergyKwh = activeSessions.reduce(
    (total, session) => total + session.kwh_billed,
    0,
  )
  if (!Number.isFinite(billedEnergyKwh) || billedEnergyKwh <= 0) {
    return { status: 'unavailable', reason: 'invalid_billed_energy' }
  }

  const plansById = new Map(
    input.chargingPlanVersions.map((plan) => [plan.id, plan]),
  )
  const timelines = createLogicalTariffTimelines(input.chargingPlanVersions)

  const qualifiedMonths = new Map<string, Set<LocalMonthKey>>()
  for (const session of activeSessions) {
    if (!isPlanSession(session)) {
      continue
    }

    const referencedPlan = session.tariff_plan_id
      ? plansById.get(session.tariff_plan_id)
      : undefined
    if (!referencedPlan) {
      return { status: 'unavailable', reason: 'missing_tariff_history' }
    }

    addQualifiedMonth(
      qualifiedMonths,
      getLogicalTariffKey(referencedPlan),
      formatLocalMonthKey(new Date(session.session_timestamp)),
    )
  }

  const asOfTomorrow = addUtcDays(asOfLocalDate, 1)
  const conflicts = findTariffConflicts(qualifiedMonths, timelines, asOfTomorrow)
  const [firstConflict, ...remainingConflicts] = conflicts
  if (firstConflict) {
    return {
      status: 'unavailable',
      reason: 'overlapping_paid_tariffs',
      conflicts: [firstConflict, ...remainingConflicts],
    }
  }

  let fractionalFixedCostCents: RationalCents = {
    numerator: 0n,
    denominator: 1n,
  }

  for (const [logicalTariffKey, months] of qualifiedMonths) {
    const versions = timelines.get(logicalTariffKey)?.versions ?? []
    for (const month of months) {
      for (const version of versions) {
        fractionalFixedCostCents = addVersionContribution(
          fractionalFixedCostCents,
          version,
          month,
          asOfTomorrow,
        )
      }
    }
  }

  const sessionSpendCents = activeSessions.reduce(
    (total, session) => total + session.total_cost,
    0,
  )
  const fixedCostCents = roundNonNegativeRationalCents(fractionalFixedCostCents)
  const includedSpendCents = sessionSpendCents + fixedCostCents

  return {
    status: 'ready',
    sessionCount: activeSessions.length,
    billedEnergyKwh,
    sessionSpendCents,
    fixedCostCents,
    includedSpendCents,
    overallPriceCtPerKwh: includedSpendCents / billedEnergyKwh,
  }
}
