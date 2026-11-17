import { getObservedProviderRateCtPerKwh, type BillingProviderGroup } from './billingProviderBreakdown'

type BillingProviderLayoutMode = 'sidebar' | 'bottom-dock'
const PROVIDER_COLORS = ['#009E73', '#007AFF', '#E69F00', '#986CC7', '#D55E00', '#007C91', '#5B5FC7', '#6F7F28', '#8F694A'] as const
const OTHERS_COLOR = '#8E8E93'

export type ProviderColor = string
/** Sort order for the named provider rows and hidden members. */
export type BillingProviderSort = 'energy' | 'spending' | 'price'

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
  sortBy: BillingProviderSort = 'energy',
): GroupedBillingProviders {
  const threshold = layoutMode === 'sidebar' ? 5 : 4
  const energyOrdered = [...providerGroups].sort((left, right) => {
    const leftEnergy = left.billedEnergyKwh
    const rightEnergy = right.billedEnergyKwh
    if (leftEnergy === null || rightEnergy === null) {
      return leftEnergy === rightEnergy
        ? (left.normalizedName < right.normalizedName ? -1 : left.normalizedName > right.normalizedName ? 1 : 0)
        : leftEnergy === null ? 1 : -1
    }
    return rightEnergy - leftEnergy
      || (left.normalizedName < right.normalizedName ? -1 : left.normalizedName > right.normalizedName ? 1 : 0)
  })
  const namedLimit = energyOrdered.length > threshold
    ? (layoutMode === 'sidebar' ? 5 : 4)
    : energyOrdered.length
  const visible = [...energyOrdered.slice(0, namedLimit)]
  const hidden = [...energyOrdered.slice(namedLimit)]
  const compareName = (left: BillingProviderGroup, right: BillingProviderGroup) =>
    left.normalizedName < right.normalizedName ? -1 : left.normalizedName > right.normalizedName ? 1 : 0
  const compareSortValue = (left: BillingProviderGroup, right: BillingProviderGroup) => {
    const leftValue = sortBy === 'energy'
      ? left.billedEnergyKwh
      : sortBy === 'spending'
        ? left.totalCostCents
        : getObservedProviderRateCtPerKwh(left)
    const rightValue = sortBy === 'energy'
      ? right.billedEnergyKwh
      : sortBy === 'spending'
        ? right.totalCostCents
        : getObservedProviderRateCtPerKwh(right)
    if (leftValue === null || rightValue === null) {
      return leftValue === rightValue ? compareName(left, right) : leftValue === null ? 1 : -1
    }
    return (sortBy === 'price' ? leftValue - rightValue : rightValue - leftValue) || compareName(left, right)
  }
  visible.sort(compareSortValue)
  hidden.sort(compareSortValue)
  const colors = assignProviderColors(energyOrdered)
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
