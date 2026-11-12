import type { BillingProviderGroup } from './billingProviderBreakdown'

type BillingProviderLayoutMode = 'sidebar' | 'bottom-dock'
const PROVIDER_BASE_HUES = [0, 45, 90, 135, 180, 225, 270, 315]
const PROVIDER_COLOR_HUES = [
  ...PROVIDER_BASE_HUES,
  22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5,
  15, 60, 105, 150, 195, 240, 285, 330,
]

export interface ProviderColor {
  hue: number
  light: string
  dark: string
}

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

function providerColor(hue: number): ProviderColor {
  return { hue, light: `hsl(${hue} 70% 38%)`, dark: `hsl(${hue} 70% 68%)` }
}

function assignProviderColors(groups: readonly BillingProviderGroup[]): Map<string, ProviderColor> {
  const colors = new Map<string, ProviderColor>()
  const sortedNames = [...new Set(groups.map(({ normalizedName }) => normalizedName))].sort()
  const usedColors = new Set<number>()

  sortedNames.forEach((name) => {
    const baseIndex = hashProviderName(name) % PROVIDER_BASE_HUES.length
    let colorIndex = baseIndex
    for (let offset = 0; offset < PROVIDER_COLOR_HUES.length && usedColors.has(colorIndex); offset += 1) {
      colorIndex = (colorIndex + 1) % PROVIDER_COLOR_HUES.length
    }
    if (usedColors.size < PROVIDER_COLOR_HUES.length) {
      usedColors.add(colorIndex)
    } else {
      colorIndex = baseIndex
    }
    colors.set(name, providerColor(PROVIDER_COLOR_HUES[colorIndex]))
  })

  return colors
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
    color: colors.get(group.normalizedName) ?? { hue: 220, light: 'hsl(220 8% 38%)', dark: 'hsl(220 8% 68%)' },
    isOthers: false,
  }))

  if (hidden.length > 0) {
    displayGroups.push({
      normalizedName: '__others__',
      name: 'Others',
      ...addGroupTotals(hidden),
      color: { hue: 220, light: 'hsl(220 8% 45%)', dark: 'hsl(220 8% 60%)' },
      members: hidden,
      isOthers: true,
    })
  }

  return { groups: displayGroups, barGroups: displayGroups, providerColors: colors, hiddenProviderCount: hidden.length }
}
