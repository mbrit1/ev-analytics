import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod } from './analyticsPeriods'
import { calculateBillingProviderBreakdown } from './billingProviderBreakdown'
import { groupBillingProviders } from './billingProviderGrouping'

/** Test suite for responsive provider grouping and stable segment colors. */
describe('groupBillingProviders', () => {
  const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date('2026-07-15T12:00:00Z'))

  function breakdownFor(
    names: string[],
    selectedPeriod = period,
    dates: string | readonly string[] = '2026-07-14',
    sessionMode: 'ad_hoc' | 'plan' = 'ad_hoc',
  ) {
    const sessions = names.map((name, index) => {
      const date = typeof dates === 'string' ? dates : dates[index] ?? dates[0]
      const shared = {
        id: `session-${index}`, user_id: 'owner', session_timestamp: new Date(`${date}T${String(index % 24).padStart(2, '0')}:00:00Z`),
        provider_name_snapshot: name, charging_type: 'AC' as const, kwh_billed: names.length - index,
        total_cost: 100, applied_session_fee: 0, created_at: new Date('2026-07-14T12:00:00Z'),
        updated_at: new Date('2026-07-14T12:00:00Z'),
      }
      return sessionMode === 'plan'
        ? { ...shared, session_mode: 'plan' as const, provider_id: 'provider-1', tariff_plan_id: 'plan-1', pricing_context: 'standard' as const }
        : {
          ...shared, session_mode: 'ad_hoc' as const, provider_id: null, tariff_plan_id: null, plan_selection_id: null,
          pricing_context: 'ad_hoc' as const, ad_hoc_pricing: { pricePerKwh: 1 },
        }
    })
    return calculateBillingProviderBreakdown(sessions, selectedPeriod)
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
    expect(reorderedColors.alpha).toBe(firstColors.alpha)
    expect(firstColors.alpha).toBe('#8F694A')
    expect(firstColors.beta).toBe('#E69F00')
  })

  it('keeps color stable when a provider crosses the mobile visibility cutoff', () => {
    // Arrange
    const original = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const reordered = breakdownFor(['Delta', 'Alpha', 'Beta', 'Gamma', 'Epsilon'])

    // Act
    const originalColor = groupBillingProviders(original.groups, 'bottom-dock').providerColors.get('gamma')
    const reorderedColor = groupBillingProviders(reordered.groups, 'bottom-dock').providerColors.get('gamma')

    // Assert
    expect(originalColor).toBe(reorderedColor)
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
    expect(originalColors.get('beta')).toBe(reorderedColors.get('beta'))
    expect(originalColors.get('zeta')).toBe(reorderedColors.get('zeta'))
  })

  it('keeps existing colors when a noncolliding provider is added', () => {
    // Arrange
    const initial = breakdownFor(['Alpha', 'Beta', 'Gamma'])
    const extended = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Omega'])

    // Act
    const initialColors = groupBillingProviders(initial.groups, 'sidebar').providerColors
    const extendedColors = groupBillingProviders(extended.groups, 'sidebar').providerColors

    // Assert
    expect(extendedColors.get('alpha')).toBe(initialColors.get('alpha'))
    expect(extendedColors.get('beta')).toBe(initialColors.get('beta'))
    expect(extendedColors.get('gamma')).toBe(initialColors.get('gamma'))
  })

  it('handles provider sets larger than the color palette deterministically', () => {
    // Arrange
    const breakdown = breakdownFor(Array.from({ length: 32 }, (_, index) => `Provider ${index}`))

    // Act
    const grouped = groupBillingProviders(breakdown.groups, 'sidebar')
    const visibleColors = grouped.groups.filter(({ isOthers }) => !isOthers).map(({ color }) => color)

    // Assert
    expect(visibleColors).toHaveLength(5)
    expect(grouped.providerColors.size).toBe(32)
    expect(visibleColors.every(Boolean)).toBe(true)
  })

  it('assigns distinct stable palette colors to the five common providers', () => {
    // Arrange
    const breakdown = breakdownFor(['Tesla', 'EnBW', 'PromoCharge', 'Cariqa', 'Electroverse'])

    // Act
    const colors = groupBillingProviders(breakdown.groups, 'sidebar').groups.map(({ color }) => color)

    // Assert
    expect(colors).toEqual(['#986CC7', '#8F694A', '#007AFF', '#E69F00', '#5B5FC7'])
    expect(new Set(colors).size).toBe(5)
  })

  it('keeps EWE Go color when Aral pulse enters or leaves selected provider data', () => {
    // Arrange
    const withAral = breakdownFor(['EWE Go', 'Aral pulse', 'Tesla'])
    const withoutAral = breakdownFor(['EWE Go', 'Tesla'])

    // Act
    const colorsWithAral = groupBillingProviders(withAral.groups, 'bottom-dock').providerColors
    const colorsWithoutAral = groupBillingProviders(withoutAral.groups, 'sidebar').providerColors

    // Assert
    expect(colorsWithAral.get('ewe go')).toBe('#007C91')
    expect(colorsWithoutAral.get('ewe go')).toBe(colorsWithAral.get('ewe go'))
  })

  it('keeps colors across selected periods with overlapping sessions and unrelated local edits', () => {
    // Arrange
    const sevenDays = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date('2026-07-15T12:00:00Z'))
    const thirtyDays = createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, new Date('2026-07-15T12:00:00Z'))
    const shortPeriod = breakdownFor(['EWE Go', 'Tesla'], sevenDays, '2026-07-14')
    const longPeriod = breakdownFor(['EWE Go', 'Tesla', 'Aral pulse'], thirtyDays, ['2026-07-14', '2026-07-14', '2026-06-20'])
    const locallyEdited = breakdownFor(['EWE Go', 'Tesla', 'A new local provider'], thirtyDays, ['2026-07-14', '2026-07-14', '2026-06-20'])

    // Act
    const shortColors = groupBillingProviders(shortPeriod.groups, 'bottom-dock').providerColors
    const longColors = groupBillingProviders(longPeriod.groups, 'sidebar').providerColors
    const editedColors = groupBillingProviders(locallyEdited.groups, 'sidebar').providerColors

    // Assert
    expect(shortPeriod.sessionCount).toBe(2)
    expect(longPeriod.sessionCount).toBe(3)
    expect(longColors.get('ewe go')).toBe(shortColors.get('ewe go'))
    expect(editedColors.get('ewe go')).toBe(shortColors.get('ewe go'))
    expect(editedColors.get('tesla')).toBe(shortColors.get('tesla'))
  })

  it('normalizes matching planned and ad-hoc provider snapshots to the same color', () => {
    // Arrange
    const adHoc = breakdownFor(['  EWE   Go  '], period, '2026-07-14', 'ad_hoc')
    const planned = breakdownFor(['eWe Go'], period, '2026-07-14', 'plan')

    // Act
    const adHocGroups = groupBillingProviders(adHoc.groups, 'sidebar')
    const plannedGroups = groupBillingProviders(planned.groups, 'sidebar')

    // Assert
    expect(adHoc.groups[0]?.normalizedName).toBe('ewe go')
    expect(planned.groups[0]?.normalizedName).toBe('ewe go')
    expect(plannedGroups.providerColors.get('ewe go')).toBe(adHocGroups.providerColors.get('ewe go'))
  })

  it('uses the dedicated neutral color for synthetic Others only', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])

    // Act
    const grouped = groupBillingProviders(breakdown.groups, 'bottom-dock')

    // Assert
    expect(grouped.groups.at(-1)?.color).toBe('#8E8E93')
    expect(grouped.groups.filter((group) => !group.isOthers).every((group) => group.color !== '#8E8E93')).toBe(true)
  })
})
