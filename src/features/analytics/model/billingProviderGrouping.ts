import type { BillingProviderGroup } from './billingProviderBreakdown'

type BillingProviderLayoutMode = 'sidebar' | 'bottom-dock'
const PROVIDER_COLORS = ['#009E73', '#007AFF', '#E69F00', '#986CC7', '#D55E00', '#007C91', '#5B5FC7', '#6F7F28', '#8F694A'] as const
const OTHERS_COLOR = '#8E8E93'

export type ProviderColor = string

/** A display group with a stable color and optional collapsed-group members. */
export interface DisplayBillingProviderGroup extends BillingProviderGroup {
  color: ProviderColor
  members?: readonly BillingProviderGroup[]
  isOthers: boolean
}

/** Groups share the same collapsed provider set for the energy bar and the list. */
export interface GroupedBillingProviders {
  groups: DisplayBillingProviderGroup[]
  barGroups: DisplayBillingProviderGroup[]
  providerColors: ReadonlyMap<string, ProviderColor>
  hiddenProviderCount: number
}

function hashProviderName(name: string): number {
  let hash = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function colorForProvider(normalizedName: string): ProviderColor {
  return PROVIDER_COLORS[hashProviderName(normalizedName) % PROVIDER_COLORS.length]
}

function assignProviderColors(groups: readonly BillingProviderGroup[]): Map<string, ProviderColor> {
  return new Map(groups.map(({ normalizedName }) => [normalizedName, colorForProvider(normalizedName)]))
}

function addGroupTotals(groups: readonly BillingProviderGroup[]): Omit<BillingProviderGroup, 'normalizedName' | 'name'> {
  const hasEnergy = groups.some(({ billedEnergyKwh }) => billedEnergyKwh !== null)
  const hasInvalidCost = groups.some(({ totalCostCents }) => totalCostCents === null)
  return {
    sessionCount: groups.reduce((sum, group) => sum + group.sessionCount, 0),
    validBilledEnergySessionCount: groups.reduce((sum, group) => sum + group.validBilledEnergySessionCount, 0),
    billedEnergyKwh: hasEnergy ? groups.reduce((sum, group) => sum + (group.billedEnergyKwh ?? 0), 0) : null,
    totalCostCents: hasInvalidCost ? null : groups.reduce((sum, group) => sum + (group.totalCostCents ?? 0), 0),
  }
}

/** Applies the Analytics mobile or desktop provider limit and stable segment colors. */
export function groupBillingProviders(
  providerGroups: readonly BillingProviderGroup[],
  layoutMode: BillingProviderLayoutMode,
): GroupedBillingProviders {
  const threshold = layoutMode === 'sidebar' ? 5 : 4
  const namedLimit = providerGroups.length > threshold
    ? (layoutMode === 'sidebar' ? 5 : 3)
    : providerGroups.length
  const visible = providerGroups.slice(0, namedLimit)
  const hidden = providerGroups.slice(namedLimit)
  const colors = assignProviderColors(providerGroups)
  const displayGroups: DisplayBillingProviderGroup[] = visible.map((group) => ({
    ...group,
    color: colorForProvider(group.normalizedName),
    isOthers: false,
  }))

  if (hidden.length > 0) {
    displayGroups.push({
      normalizedName: '__others__',
      name: 'Others',
      ...addGroupTotals(hidden),
      color: OTHERS_COLOR,
      members: hidden,
      isOthers: true,
    })
  }

  return { groups: displayGroups, barGroups: displayGroups, providerColors: colors, hiddenProviderCount: hidden.length }
}
