import type { ChargingSession } from '../../charging-sessions'
import type { AnalyticsPeriodBounds } from './analyticsPeriods'

/** Aggregated billed amount and energy for one normalized billing-provider snapshot. */
export interface BillingProviderGroup {
  /** Trimmed, case-folded identity key; empty for sessions with a blank snapshot. */
  normalizedName: string
  /** Newest recorded snapshot spelling, or the explicit label for a blank snapshot. */
  name: string
  sessionCount: number
  validBilledEnergySessionCount: number
  billedEnergyKwh: number | null
  totalCostCents: number | null
}

/** Owner-scoped selected-period totals grouped by recorded billing-provider snapshots. */
export interface BillingProviderBreakdown {
  groups: BillingProviderGroup[]
  totalSessionSpendCents: number | null
  averageSessionPriceCtPerKwh: number | null
  billedEnergyKwh: number | null
  sessionCount: number
  validBilledEnergySessionCount: number
  periodStartUtc: Date
  periodEndUtc: Date
}

interface MutableBillingProviderGroup {
  normalizedName: string
  name: string
  newestTimestamp: number
  newestSessionId: string
  sessionCount: number
  validBilledEnergySessionCount: number
  billedEnergyKwh: number
  hasBilledEnergy: boolean
  totalCostCents: number
  hasInvalidCost: boolean
}

function isValidCost(totalCost: number): boolean {
  return Number.isFinite(totalCost) && Number.isInteger(totalCost) && totalCost >= 0
}

function isValidBilledEnergy(kwhBilled: number): boolean {
  return Number.isFinite(kwhBilled) && kwhBilled > 0
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Groups active sessions inside the selected half-open period by billing snapshot.
 * For equal timestamps, the lexically greater session ID supplies the displayed spelling.
 */
export function calculateBillingProviderBreakdown(
  sessions: readonly ChargingSession[],
  period: AnalyticsPeriodBounds,
): BillingProviderBreakdown {
  const includedSessions = sessions.filter((session) => {
    const timestamp = new Date(session.session_timestamp).getTime()
    return !session.deleted_at
      && timestamp >= period.startUtc.getTime()
      && timestamp < period.endUtc.getTime()
  })
  const groupsByName = new Map<string, MutableBillingProviderGroup>()

  for (const session of includedSessions) {
    const snapshot = (session.provider_name_snapshot ?? '').trim()
    const normalizedName = snapshot.toLowerCase()
    const timestamp = new Date(session.session_timestamp).getTime()
    let group = groupsByName.get(normalizedName)

    if (!group) {
      group = {
        normalizedName,
        name: snapshot || 'Unknown provider',
        newestTimestamp: timestamp,
        newestSessionId: session.id,
        sessionCount: 0,
        validBilledEnergySessionCount: 0,
        billedEnergyKwh: 0,
        hasBilledEnergy: false,
        totalCostCents: 0,
        hasInvalidCost: false,
      }
      groupsByName.set(normalizedName, group)
    } else if (
      timestamp > group.newestTimestamp
      || (timestamp === group.newestTimestamp && session.id > group.newestSessionId)
    ) {
      group.name = snapshot || 'Unknown provider'
      group.newestTimestamp = timestamp
      group.newestSessionId = session.id
    }

    group.sessionCount += 1
    if (isValidBilledEnergy(session.kwh_billed)) {
      group.validBilledEnergySessionCount += 1
      group.billedEnergyKwh += session.kwh_billed
      group.hasBilledEnergy = true
    }
    if (isValidCost(session.total_cost)) {
      group.totalCostCents += session.total_cost
    } else {
      group.hasInvalidCost = true
    }
  }

  const groups = [...groupsByName.values()]
    .map<BillingProviderGroup>((group) => ({
      normalizedName: group.normalizedName,
      name: group.name,
      sessionCount: group.sessionCount,
      validBilledEnergySessionCount: group.validBilledEnergySessionCount,
      billedEnergyKwh: group.hasBilledEnergy ? group.billedEnergyKwh : null,
      totalCostCents: group.hasInvalidCost ? null : group.totalCostCents,
    }))
    .sort((left, right) => {
      const energyDifference = (right.billedEnergyKwh ?? 0) - (left.billedEnergyKwh ?? 0)
      return energyDifference || compareNames(left.normalizedName, right.normalizedName)
    })

  const totalSessionSpendCents = includedSessions.every((session) => isValidCost(session.total_cost))
    ? includedSessions.reduce((total, session) => total + session.total_cost, 0)
    : null
  const validBilledEnergySessions = includedSessions.filter((session) => isValidBilledEnergy(session.kwh_billed))
  const billedEnergyKwh = validBilledEnergySessions.length > 0
    ? validBilledEnergySessions.reduce((total, session) => total + session.kwh_billed, 0)
    : null

  return {
    groups,
    totalSessionSpendCents,
    averageSessionPriceCtPerKwh: totalSessionSpendCents !== null
      && billedEnergyKwh !== null
      && validBilledEnergySessions.length === includedSessions.length
      ? totalSessionSpendCents / billedEnergyKwh
      : null,
    billedEnergyKwh,
    sessionCount: includedSessions.length,
    validBilledEnergySessionCount: validBilledEnergySessions.length,
    periodStartUtc: period.startUtc,
    periodEndUtc: period.endUtc,
  }
}
