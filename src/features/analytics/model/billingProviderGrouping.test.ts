import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod } from './analyticsPeriods'
import { calculateBillingProviderBreakdown } from './billingProviderBreakdown'
import { groupBillingProviders } from './billingProviderGrouping'

/** Test suite for responsive provider grouping and stable segment colors. */
describe('groupBillingProviders', () => {
  const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date('2026-07-15T12:00:00Z'))

  function breakdownFor(names: string[]) {
    return calculateBillingProviderBreakdown(names.map((name, index) => ({
      id: `session-${index}`, user_id: 'owner', session_mode: 'ad_hoc' as const,
      provider_id: null, tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc' as const,
      ad_hoc_pricing: { pricePerKwh: 1 }, session_timestamp: new Date(`2026-07-14T${String(index % 24).padStart(2, '0')}:00:00Z`),
      provider_name_snapshot: name, charging_type: 'AC' as const, kwh_billed: names.length - index,
      total_cost: 100, applied_session_fee: 0, created_at: new Date('2026-07-14T12:00:00Z'),
      updated_at: new Date('2026-07-14T12:00:00Z'),
    })), period)
  }

  it('uses mobile and desktop limits and keeps the same groups for rows and bar', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])

    // Act
    const mobile = groupBillingProviders(breakdown.groups, 'bottom-dock')
    const desktop = groupBillingProviders(breakdown.groups, 'sidebar')

    // Assert
    expect(mobile.groups.map(({ name }) => name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Others'])
    expect(desktop.groups.map(({ name }) => name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Others'])
    expect(mobile.groups.at(-1)).toMatchObject({ name: 'Others', sessionCount: 3, billedEnergyKwh: 6, totalCostCents: 300 })
    expect(mobile.barGroups).toEqual(mobile.groups)
  })

  it.each([
    ['bottom-dock', 4, 4, 0],
    ['bottom-dock', 5, 3, 2],
    ['sidebar', 5, 5, 0],
    ['sidebar', 6, 5, 1],
  ] as const)('applies the %s threshold with %i providers', (layout, count, named, hidden) => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].slice(0, count))

    // Act
    const grouped = groupBillingProviders(breakdown.groups, layout)

    // Assert
    expect(grouped.groups.filter((group) => !group.isOthers)).toHaveLength(named)
    expect(grouped.hiddenProviderCount).toBe(hidden)
    expect(grouped.groups.filter((group) => group.isOthers)).toHaveLength(hidden > 0 ? 1 : 0)
  })

  it('keeps a provider color stable when rank changes and resolves collisions deterministically', () => {
    // Arrange
    const first = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const reordered = breakdownFor(['Beta', 'Gamma', 'Delta', 'Epsilon', 'Alpha'])

    // Act
    const firstColors = Object.fromEntries(groupBillingProviders(first.groups, 'sidebar').groups.map((group) => [group.normalizedName, group.color]))
    const reorderedColors = Object.fromEntries(groupBillingProviders(reordered.groups, 'sidebar').groups.map((group) => [group.normalizedName, group.color]))

    // Assert
    expect(reorderedColors.alpha?.light).toBe(firstColors.alpha?.light)
    expect(new Set(Object.values(firstColors).map(({ light }) => light)).size).toBe(Object.values(firstColors).length)
  })

  it('keeps color stable when a provider crosses the mobile visibility cutoff', () => {
    // Arrange
    const original = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const reordered = breakdownFor(['Delta', 'Alpha', 'Beta', 'Gamma', 'Epsilon'])

    // Act
    const originalColor = groupBillingProviders(original.groups, 'bottom-dock').providerColors.get('gamma')
    const reorderedColor = groupBillingProviders(reordered.groups, 'bottom-dock').providerColors.get('gamma')

    // Assert
    expect(originalColor?.light).toBe(reorderedColor?.light)
    expect(groupBillingProviders(original.groups, 'bottom-dock').groups.at(-1)?.isOthers).toBe(true)
  })

  it('keeps colliding identities stable when either crosses the mobile cutoff', () => {
    // Arrange
    const original = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Zeta', 'Delta'])
    const reordered = breakdownFor(['Alpha', 'Zeta', 'Gamma', 'Beta', 'Delta'])

    // Act
    const originalColors = groupBillingProviders(original.groups, 'bottom-dock').providerColors
    const reorderedColors = groupBillingProviders(reordered.groups, 'bottom-dock').providerColors

    // Assert
    expect(originalColors.get('beta')?.hue).toBe(reorderedColors.get('beta')?.hue)
    expect(originalColors.get('zeta')?.hue).toBe(reorderedColors.get('zeta')?.hue)
  })

  it('keeps existing colors when a noncolliding provider is added', () => {
    // Arrange
    const initial = breakdownFor(['Alpha', 'Beta', 'Gamma'])
    const extended = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Omega'])

    // Act
    const initialColors = groupBillingProviders(initial.groups, 'sidebar').providerColors
    const extendedColors = groupBillingProviders(extended.groups, 'sidebar').providerColors

    // Assert
    expect(extendedColors.get('alpha')?.hue).toBe(initialColors.get('alpha')?.hue)
    expect(extendedColors.get('beta')?.hue).toBe(initialColors.get('beta')?.hue)
    expect(extendedColors.get('gamma')?.hue).toBe(initialColors.get('gamma')?.hue)
  })

  it('handles provider sets larger than the color palette deterministically', () => {
    // Arrange
    const breakdown = breakdownFor(Array.from({ length: 32 }, (_, index) => `Provider ${index}`))

    // Act
    const grouped = groupBillingProviders(breakdown.groups, 'sidebar')
    const visibleColors = grouped.groups.filter(({ isOthers }) => !isOthers).map(({ color }) => color.light)

    // Assert
    expect(visibleColors).toHaveLength(5)
    expect(grouped.providerColors.size).toBe(32)
    expect(visibleColors.every(Boolean)).toBe(true)
  })

  it('spreads typical provider colors apart using normalized-name ordering', () => {
    // Arrange
    const breakdown = breakdownFor(['Tesla', 'EnBW', 'PromoCharge', 'Cariqa'])

    // Act
    const hues = groupBillingProviders(breakdown.groups, 'sidebar').groups.map(({ color }) => color.hue)
    const hueDistances = hues.flatMap((hue, index) => hues.slice(index + 1).map((otherHue) => {
      const difference = Math.abs(hue - otherHue)
      return Math.min(difference, 360 - difference)
    }))

    // Assert
    expect(Math.min(...hueDistances)).toBeGreaterThanOrEqual(40)
  })

  it('keeps visible colors distinct when many providers are collapsed into Others', () => {
    // Arrange
    const names = [
      'Tesla', 'EnBW', 'PromoCharge', 'Cariqa', 'Zeta',
      ...Array.from({ length: 16 }, (_, index) => `zz Hidden Provider ${index}`),
    ]
    const breakdown = breakdownFor(names)

    // Act
    const visible = groupBillingProviders(breakdown.groups, 'sidebar').groups.filter(({ isOthers }) => !isOthers)
    const hues = visible.map(({ color }) => color.hue)
    const hueDistances = hues.flatMap((hue, index) => hues.slice(index + 1).map((otherHue) => {
      const difference = Math.abs(hue - otherHue)
      return Math.min(difference, 360 - difference)
    }))

    // Assert
    expect(visible).toHaveLength(5)
    expect(Math.min(...hueDistances)).toBeGreaterThanOrEqual(40)
  })
})
