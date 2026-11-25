import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateBillingProviderBreakdown } from '../model/billingProviderBreakdown'
import { groupBillingProviders } from '../model/billingProviderGrouping'
import { BillingProviderBreakdownSlab } from './BillingProviderBreakdownSlab'
import userEvent from '@testing-library/user-event'

/** Test suite for selected-period provider totals and coverage states. */
describe('BillingProviderBreakdownSlab', () => {
  const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date('2026-07-15T12:00:00Z'))

  function breakdownFor(names: string[], partialProviderName?: string, unavailableEnergyProviderName?: string) {
    const sessions = names.map((name, index) => ({
      id: `provider-session-${index}`, user_id: 'owner', session_mode: 'ad_hoc' as const,
      provider_id: null, tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc' as const,
      ad_hoc_pricing: { pricePerKwh: 10 }, session_timestamp: new Date(`2026-07-14T${String(index).padStart(2, '0')}:00:00Z`),
      provider_name_snapshot: name, charging_type: 'AC' as const,
      kwh_billed: name === unavailableEnergyProviderName ? Number.NaN : names.length - index,
      total_cost: 100, applied_session_fee: 0, created_at: new Date('2026-07-14T12:00:00Z'),
      updated_at: new Date('2026-07-14T12:00:00Z'),
    }))
    if (partialProviderName) {
      sessions.push({
        id: 'partial-energy-session', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null,
        tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 10 },
        session_timestamp: new Date('2026-07-14T23:30:00Z'), provider_name_snapshot: partialProviderName,
        charging_type: 'AC', kwh_billed: 0, total_cost: 100, applied_session_fee: 0,
        created_at: new Date('2026-07-14T23:30:00Z'), updated_at: new Date('2026-07-14T23:30:00Z'),
      })
    }
    return calculateBillingProviderBreakdown(sessions, period)
  }

  it('shows the period energy total and provider rows without duplicate spend or energy KPIs', () => {
    // Arrange
    const breakdown = calculateBillingProviderBreakdown([{
      id: 'session-1', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 50 },
      session_timestamp: new Date('2026-07-14T12:00:00Z'), provider_name_snapshot: 'Example Charge',
      charging_type: 'AC', kwh_billed: 12.5, total_cost: 3250, applied_session_fee: 0,
      created_at: new Date('2026-07-14T12:00:00Z'), updated_at: new Date('2026-07-14T12:00:00Z'),
    }], period)

    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} />)

    // Assert
    expect(screen.getByText('Billing providers')).toBeInTheDocument()
    expect(screen.getByText('12,5', { selector: 'p' })).toHaveTextContent('kWh')
    expect(screen.getAllByText('32,50 €')).toHaveLength(1)
    expect(screen.getAllByText(/12,5/)).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'Provider totals' })).toHaveTextContent('12,5 kWh')
    expect(screen.queryByText('Total spend')).not.toBeInTheDocument()
    expect(screen.getByText('Example Charge')).toBeInTheDocument()
  })

  it('emphasizes the mobile observed rate above spend and keeps billed energy under the name', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta'], 'Beta')
    breakdown.groups[0] = { ...breakdown.groups[0], totalCostCents: 0 }

    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)

    // Assert
    const [alpha, beta] = within(screen.getByRole('list', { name: 'Provider totals' })).getAllByRole('listitem')
    const rate = within(alpha).getByText('0,00 €/kWh')
    const spend = within(alpha).getByText('0,00 €')
    expect(rate).toHaveClass('font-semibold', 'tabular-nums')
    expect(spend.closest('.text-slab-secondary')).toBeInTheDocument()
    expect(rate.compareDocumentPosition(spend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alpha).toHaveTextContent(/Alpha.*2 kWh.*0,00 €\/kWh.*0,00 €.*Free/)
    expect(beta).toHaveTextContent(/Beta.*1 kWh.*1\/2 measured.*Rate unavailable.*2,00 €/)
  })

  it('sorts the same energy-selected mobile rows and keeps Others last with matching bar colors', async () => {
    // Arrange
    const user = userEvent.setup()
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], 'Beta')
    breakdown.groups[2] = { ...breakdown.groups[2], totalCostCents: 50 }
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    const sort = screen.getByRole('combobox', { name: 'Sort providers' })
    const list = screen.getByRole('list', { name: 'Provider totals' })
    const bar = screen.getByRole('img', { name: /^Known billed energy by provider:/ })

    // Act / Assert
    expect(sort.tagName).toBe('SELECT')
    expect(sort).toHaveValue('energy')
    expect(within(sort).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Most energy', 'Most spend', 'Lowest rate',
    ])
    expect(within(sort).getByRole('option', { name: 'Billed energy, highest first' })).toBeInTheDocument()
    expect(within(sort).getByRole('option', { name: 'Session spend, highest first' })).toBeInTheDocument()
    expect(within(sort).getByRole('option', { name: 'Observed rate, lowest first' })).toBeInTheDocument()
    const assertOrder = (order: string[]) => {
      const rows = within(list).getAllByRole('listitem')
      rows.forEach((row, index) => expect(row).toHaveTextContent(order[index]))
      expect(rows).toHaveLength(5)
      const color = (node: Element | null) => (node as HTMLElement).style.getPropertyValue('--provider-color')
      expect(rows.map((row) => color(row.querySelector('[style*="--provider-color"]'))))
        .toEqual([...bar.children].map(color))
    }
    assertOrder(['Alpha', 'Beta', 'Gamma', 'Delta', 'Others'])
    await user.selectOptions(sort, 'spending')
    assertOrder(['Beta', 'Alpha', 'Delta', 'Gamma', 'Others'])
    await user.selectOptions(sort, 'price')
    assertOrder(['Gamma', 'Alpha', 'Delta', 'Beta', 'Others'])
    expect(within(list).getByRole('button', { name: 'Show 2 other providers' })).toHaveAccessibleDescription(
      /Billed energy 3 kWh.*Session spend 2,00 €.*Observed session rate 0,67 €\/kWh/,
    )
  })

  it('shows observed rates and lets the user choose provider ordering', async () => {
    // Arrange
    const user = userEvent.setup()
    const breakdown = calculateBillingProviderBreakdown([{
      id: 'session-1', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 50 },
      session_timestamp: new Date('2026-07-14T12:00:00Z'), provider_name_snapshot: 'Example Charge',
      charging_type: 'AC', kwh_billed: 10, total_cost: 3250, applied_session_fee: 0,
      created_at: new Date('2026-07-14T12:00:00Z'), updated_at: new Date('2026-07-14T12:00:00Z'),
    }, {
      id: 'session-2', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 0 },
      session_timestamp: new Date('2026-07-14T13:00:00Z'), provider_name_snapshot: 'Free Charge',
      charging_type: 'AC', kwh_billed: 5, total_cost: 0, applied_session_fee: 0,
      created_at: new Date('2026-07-14T13:00:00Z'), updated_at: new Date('2026-07-14T13:00:00Z'),
    }, {
      id: 'session-3', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 0 },
      session_timestamp: new Date('2026-07-14T14:00:00Z'), provider_name_snapshot: 'Incomplete Charge',
      charging_type: 'AC', kwh_billed: 2, total_cost: Number.NaN, applied_session_fee: 0,
      created_at: new Date('2026-07-14T14:00:00Z'), updated_at: new Date('2026-07-14T14:00:00Z'),
    }], period)

    // Act
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)

    // Assert
    expect(screen.getByRole('combobox', { name: 'Sort providers' })).toBeInTheDocument()
    expect(screen.getAllByText('Observed session rate').length).toBeGreaterThan(0)
    const methodologyTrigger = screen.getByRole('button', { name: 'How provider rates are calculated' })
    expect(screen.queryByText(/Observed provider rate divides/)).not.toBeInTheDocument()
    await user.click(methodologyTrigger)
    const methodology = screen.getByRole('region', { name: 'How provider rates are calculated' })
    expect(methodology).toHaveTextContent('Observed provider rate divides recorded session spend by billed energy')
    expect(methodology).toHaveTextContent('Rates are unavailable when recorded cost or billed energy is incomplete.')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('list', { name: 'Provider totals' })).toHaveTextContent('3,25 €/kWh')
    expect(screen.getByRole('list', { name: 'Provider totals' })).toHaveTextContent('0,00 €/kWh')
    expect(screen.queryByText('Unavailable rates indicate incomplete recorded cost or billed energy.')).not.toBeInTheDocument()
    expect(screen.getAllByText('Unavailable', { selector: 'span' }).length).toBeGreaterThan(0)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort providers' }), 'price')
    expect(screen.getByRole('combobox', { name: 'Sort providers' })).toHaveValue('price')
    expect([...screen.getByRole('list', { name: 'Provider totals' }).querySelectorAll(':scope > li')].map((row) => row.textContent?.match(/(Free Charge|Example Charge|Incomplete Charge)/)?.[1])).toEqual([
      'Free Charge', 'Example Charge', 'Incomplete Charge',
    ])
    rerender(<BillingProviderBreakdownSlab breakdown={breakdownFor(['Example Charge', 'Free Charge'])} isLoading={false} layoutMode="sidebar" />)
    expect(screen.getByRole('combobox', { name: 'Sort providers' })).toHaveValue('price')
  })

  it('marks the pooled Others observed rate unavailable when a hidden provider has incomplete data', () => {
    // Arrange: Epsilon has one valid and one energy-missing session in the hidden group.
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'], 'Epsilon')

    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)

    // Assert
    expect(screen.getByRole('button', { name: 'Show 1 other provider' })).toHaveAccessibleDescription(/Observed session rate Unavailable; incomplete cost or energy data/)
  })

  it('keeps desktop Others expanded when sorting reorders its members', async () => {
    // Arrange: Energy makes Zeta, Eta, and Theta hidden; spend reorders them.
    const user = userEvent.setup()
    const base = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'])
    const breakdown = {
      ...base,
      groups: base.groups.map((group) => ({
        ...group,
        totalCostCents: group.normalizedName === 'eta' ? 100 : group.normalizedName === 'zeta' ? 1000 : group.normalizedName === 'theta' ? 500 : group.totalCostCents,
      })),
    }

    // Act: Expand desktop Others and select spending order.
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)
    await user.click(screen.getByRole('button', { name: 'Others (3 providers)' }))
    expect(screen.getByRole('list', { name: 'Other provider totals' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort providers' }), 'spending')

    // Assert: Sorting reorders hidden rows without closing their disclosure.
    const members = screen.getByRole('list', { name: 'Other provider totals' })
    expect([...members.querySelectorAll(':scope > li')].map((row) => row.textContent?.match(/(Zeta|Eta|Theta)/)?.[1])).toEqual(['Zeta', 'Theta', 'Eta'])
    expect(screen.getByRole('button', { name: 'Others (3 providers)' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders loading, error, empty, free, and unavailable energy states', () => {
    // Arrange
    const empty = calculateBillingProviderBreakdown([], period)
    const partial = calculateBillingProviderBreakdown([{
      id: 'measured', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 0 },
      session_timestamp: new Date('2026-07-14T12:00:00Z'), provider_name_snapshot: 'Mixed Provider',
      charging_type: 'AC', kwh_billed: 2, total_cost: 100, applied_session_fee: 0,
      created_at: new Date('2026-07-14T12:00:00Z'), updated_at: new Date('2026-07-14T12:00:00Z'),
    }, {
      id: 'invalid', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 0 },
      session_timestamp: new Date('2026-07-14T13:00:00Z'), provider_name_snapshot: 'Mixed Provider',
      charging_type: 'AC', kwh_billed: 0, total_cost: Number.NaN, applied_session_fee: 0,
      created_at: new Date('2026-07-14T13:00:00Z'), updated_at: new Date('2026-07-14T13:00:00Z'),
    }, {
      id: 'free', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 0 },
      session_timestamp: new Date('2026-07-14T14:00:00Z'), provider_name_snapshot: 'Free Provider',
      charging_type: 'AC', kwh_billed: 0, total_cost: 0, applied_session_fee: 0,
      created_at: new Date('2026-07-14T14:00:00Z'), updated_at: new Date('2026-07-14T14:00:00Z'),
    }], period)

    // Act / Assert
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={empty} isLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading billing providers')
    rerender(<BillingProviderBreakdownSlab breakdown={empty} isLoading={false} error={new Error('offline')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load billing providers')
    rerender(<BillingProviderBreakdownSlab breakdown={empty} isLoading={false} />)
    expect(screen.getByText('No charging sessions recorded for this period.')).toBeInTheDocument()
    rerender(<BillingProviderBreakdownSlab breakdown={partial} isLoading={false} />)
    expect(screen.getByText('Mixed Provider')).toBeInTheDocument()
    expect(screen.getByText('2', { selector: 'p' })).toHaveTextContent('kWh')
    expect(screen.getByText('At least one session has an invalid recorded cost.')).toBeInTheDocument()
    expect(screen.getByText('Available for 1 of 3 sessions.')).toBeInTheDocument()
    expect(screen.getByText(/1\/2 measured/)).toBeVisible()
    expect(screen.getByText('Free Provider')).toBeInTheDocument()
    expect(screen.getByText('Free', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Spend unavailable')).toBeVisible()
    expect(screen.getAllByText('Rate unavailable')).toHaveLength(2)
    expect(screen.getByText(/Energy unavailable/)).toBeInTheDocument()
  })

  it('labels the desktop provider columns and gives unavailable values context', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta'], undefined, 'Beta')

    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)

    // Assert
    const headings = screen.getByText('Provider').parentElement!
    expect([...headings.children].map((heading) => heading.textContent)).toEqual(['Provider', 'Billed energy', 'Observed session rate', 'Session spend'])
    expect(headings).toHaveAttribute('aria-hidden', 'true')
    expect(headings).toHaveClass('hidden', 'lg:grid', 'text-slab-secondary')
    expect(screen.getByText('Billed energy', { selector: '.sr-only' }).parentElement).toHaveTextContent('Billed energy Unavailable')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getAllByText('1,00 €')).toHaveLength(2)
  })

  it.each([
    ['sidebar', 'region'],
    ['bottom-dock', 'dialog'],
  ] as const)('keeps provider methodology hidden until opened in %s layout', async (layoutMode, surfaceRole) => {
    // Arrange: Render a populated provider breakdown in the requested layout.
    const user = userEvent.setup()
    render(<BillingProviderBreakdownSlab breakdown={breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])} isLoading={false} layoutMode={layoutMode} />)
    const trigger = screen.getByRole('button', { name: 'How provider rates are calculated' })

    // Act: Open the methodology from the stable slab heading.
    expect(screen.queryByText(/Observed provider rate divides/)).not.toBeInTheDocument()
    await user.click(trigger)

    // Assert: The adaptive surface explains the historical formula and restores heading focus.
    const surface = screen.getByRole(surfaceRole, { name: 'How provider rates are calculated' })
    expect(surface).toHaveTextContent('Observed provider rate divides recorded session spend by billed energy')
    expect(surface).toHaveTextContent('It excludes subscription fees and describes recorded sessions, not a future tariff.')
    expect(surface).toHaveTextContent('Rates are unavailable when recorded cost or billed energy is incomplete.')
    if (layoutMode === 'sidebar') {
      expect(surface.querySelectorAll('p')).toHaveLength(1)
    }
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('shows mobile grouping context only with Others and explains sorting in the methodology', async () => {
    // Arrange: Compare a short provider list with one that requires Others.
    const user = userEvent.setup()
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdownFor(['Alpha', 'Beta'])} isLoading={false} />)

    // Assert: The note is conditional on a real collapsed group.
    expect(screen.queryByText(/Top providers by billed energy/)).not.toBeInTheDocument()
    rerender(<BillingProviderBreakdownSlab breakdown={breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])} isLoading={false} />)
    expect(screen.getByText('Top providers by billed energy. Others groups the rest.')).toBeVisible()
    expect(screen.queryByText('Sorting and grouping')).not.toBeInTheDocument()
    expect(screen.queryByText(/Changing the sort order rearranges/)).not.toBeInTheDocument()

    // Act
    await user.click(screen.getByRole('button', { name: 'How provider rates are calculated' }))

    // Assert
    const sheet = within(screen.getByRole('dialog', { name: 'How provider rates are calculated' }))
    expect(sheet.getByRole('heading', { name: 'Sorting and grouping' })).toBeVisible()
    expect(sheet.getByText('The top providers are selected by billed energy. Changing the sort order rearranges these providers but does not change which providers are shown. Others contains the remaining providers.')).toBeVisible()
  })

  it('uses the same fixed palette color for each provider bar segment and row dot', () => {
    // Arrange
    const breakdown = breakdownFor(['EWE Go', 'Aral pulse'])
    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} />)

    // Assert
    const bar = screen.getByRole('img', { name: /Billed energy by provider/ })
    const segments = [...bar.querySelectorAll('span')]
    const rows = screen.getByRole('list', { name: 'Provider totals' })
    const providerColor = (element: Element) => (element as HTMLElement).style.getPropertyValue('--provider-color')

    expect(segments.map(providerColor)).toEqual(['#007C91', '#8F694A'])
    expect(segments[1]).toHaveClass('border-l', 'border-surface')
    expect(providerColor(screen.getByText('EWE Go').parentElement!.previousElementSibling!)).toBe('#007C91')
    expect(providerColor(screen.getByText('Aral pulse').parentElement!.previousElementSibling!)).toBe('#8F694A')
    expect(rows).toBeInTheDocument()
  })

  it('labels the energy distribution according to measurement coverage', () => {
    // Arrange
    const complete = breakdownFor(['Alpha', 'Beta'])
    const partial = breakdownFor(['Alpha', 'Beta'], 'Alpha')

    // Act / Assert
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={complete} isLoading={false} />)
    expect(screen.getByText('Billed energy by provider')).toBeVisible()
    expect(screen.getByRole('img', { name: /^Billed energy by provider: Alpha 2 kWh, Beta 1 kWh$/ })).toBeInTheDocument()
    rerender(<BillingProviderBreakdownSlab breakdown={partial} isLoading={false} />)
    expect(screen.getByText('Known billed energy by provider')).toBeVisible()
    expect(screen.getByText('3', { selector: 'p' })).toHaveTextContent('kWh')
    expect(screen.getByRole('img', { name: /^Known billed energy by provider: Alpha 2 kWh, Beta 1 kWh$/ })).toBeInTheDocument()
    expect(screen.getByText('Available for 2 of 3 sessions.')).toBeInTheDocument()
  })

  it('uses the layout limit and expands Others without changing the collapsed subtotal', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'], 'Epsilon', 'Eta')

    // Act
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)

    // Assert
    expect(screen.getByRole('img', { name: /Alpha 7 kWh, Beta 6 kWh, Gamma 5 kWh, Delta 4 kWh, Others 5 kWh/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 3 other providers' })).not.toHaveAttribute('aria-expanded')
    const providerColor = (element: Element) => (element as HTMLElement).style.getPropertyValue('--provider-color')
    const mobileBar = screen.getByRole('img', { name: /Alpha 7 kWh, Beta 6 kWh, Gamma 5 kWh, Delta 4 kWh, Others 5 kWh/ })
    const mobileSegments = [...mobileBar.querySelectorAll('span')]
    expect(mobileSegments).toHaveLength(5)
    expect(providerColor(mobileSegments.at(-1)!)).toBe('#8E8E93')
    expect(providerColor(screen.getByRole('button', { name: 'Show 3 other providers' }).querySelector('span[aria-hidden="true"]')!)).toBe('#8E8E93')
    expect(screen.queryByText('Epsilon')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 other providers' }))
    expect(screen.getByRole('dialog', { name: 'Other billing providers' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Other provider totals' })).getByText('Epsilon')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Other provider totals' })).getByText('Zeta')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Other provider totals' })).getByText('Eta')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Others 5 kWh/ })).toBeInTheDocument()

    rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Alpha 7 kWh, Beta 6 kWh, Gamma 5 kWh, Delta 4 kWh, Epsilon 3 kWh, Others 2 kWh/ })).toBeInTheDocument()
    const desktopBar = screen.getByRole('img', { name: /Known billed energy by provider/ })
    const desktopSegments = [...desktopBar.querySelectorAll('span')]
    expect(desktopSegments).toHaveLength(6)
    expect(providerColor(desktopSegments.at(-1)!)).toBe('#8E8E93')
    expect(screen.getByRole('button', { name: 'Others (2 providers)' })).toBeInTheDocument()
    expect(providerColor(screen.getByRole('button', { name: 'Others (2 providers)' }).parentElement!.parentElement!.firstElementChild!)).toBe('#8E8E93')
    expect(screen.getAllByText('1/2 measured')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Others (2 providers)' }))
    expect(screen.getByRole('button', { name: 'Others (2 providers)' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('list', { name: 'Other provider totals' })).getByText('Zeta')).toBeInTheDocument()
  })

  it('opens Others as a modal bottom sheet on mobile with the correct provider totals and colors', async () => {
    // Arrange: More than four providers produce a mobile Others group.
    const user = userEvent.setup()
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'])
    const { container } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    const trigger = screen.getByRole('button', { name: 'Show 3 other providers' })
    expect(trigger).toHaveAccessibleDescription(/Observed session rate 0,50 €\/kWh/)

    // Act: Open the complete Others row.
    await user.click(trigger)

    // Assert: The sheet exposes only the hidden group, preserves provider colors, and isolates the page.
    const dialog = screen.getByRole('dialog', { name: 'Other billing providers' })
    const memberList = screen.getByRole('list', { name: 'Other provider totals' })
    const colorFor = (name: string) => groupBillingProviders(breakdown.groups, 'bottom-dock').providerColors.get(name.toLowerCase())
    const dotFor = (name: string) => screen.getByText(name).parentElement!.previousElementSibling as HTMLElement
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('3 additional providers')
    expect(dialog).toHaveClass('overflow-hidden', 'pt-[max(1rem,env(safe-area-inset-top))]')
    expect(memberList).toBeInTheDocument()
    expect(memberList.parentElement).toHaveClass('overflow-y-auto', 'overscroll-contain')
    expect(within(memberList).getByText('Epsilon')).toBeInTheDocument()
    expect(within(memberList).getByText('Zeta')).toBeInTheDocument()
    expect(within(memberList).getByText('Eta')).toBeInTheDocument()
    const [epsilon, zeta, eta] = within(memberList).getAllByRole('listitem')
    expect(epsilon).toHaveTextContent(/Epsilon.*3 kWh.*0,33 €\/kWh.*1,00 €/)
    expect(zeta).toHaveTextContent(/Zeta.*2 kWh.*0,50 €\/kWh.*1,00 €/)
    expect(eta).toHaveTextContent(/Eta.*1 kWh.*1,00 €\/kWh.*1,00 €/)
    expect(within(epsilon).getByText('0,33 €/kWh')).toHaveClass('font-semibold', 'tabular-nums')
    expect(dotFor('Epsilon').style.getPropertyValue('--provider-color')).toBe(colorFor('Epsilon'))
    expect(dotFor('Zeta').style.getPropertyValue('--provider-color')).toBe(colorFor('Zeta'))
    expect(screen.getByRole('button', { name: 'Close other billing providers' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close other billing providers' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    expect(container).toHaveAttribute('inert')

    // Act: Escape dismisses the modal.
    await user.keyboard('{Escape}')

    // Assert: Focus, scrolling, and background interaction return to their prior state.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    expect(container).not.toHaveAttribute('inert')
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close other billing providers' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses the mobile Others sheet from its backdrop and when layout or group membership changes', async () => {
    // Arrange: Render a mobile Others group and open its sheet.
    const user = userEvent.setup()
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    const trigger = screen.getByRole('button', { name: 'Show 2 other providers' })
    await user.click(trigger)

    // Act / Assert: Backdrop dismissal closes the sheet and restores focus.
    await user.click(screen.getByRole('button', { name: 'Dismiss other billing providers' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    // Act: Reopen and change to the desktop layout.
    await user.click(trigger)
    rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)

    // Assert: Layout changes close the mobile sheet and restore existing inline Others behavior.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Others \(1 provider\)/ })).toBeInTheDocument()

    // Act: Reopen mobile sheet and change the group membership so no Others group remains.
    rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    await user.click(screen.getByRole('button', { name: 'Show 2 other providers' }))
    rerender(<BillingProviderBreakdownSlab breakdown={breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta'])} isLoading={false} layoutMode="bottom-dock" />)

    // Assert: The stale member sheet closes when the Others group disappears.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Others/ })).not.toBeInTheDocument()
  })

  it.each(['loading', 'error'] as const)('dismisses Others and restores page interaction when provider data becomes %s', async (blockedState) => {
    // Arrange: Open the Others sheet, which temporarily locks page scrolling and background interaction.
    const user = userEvent.setup()
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])
    const { container, rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    await user.click(screen.getByRole('button', { name: 'Show 2 other providers' }))
    expect(screen.getByRole('dialog', { name: 'Other billing providers' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    // Act / Assert: The blocked state hides stale rows and releases the modal page lock.
    if (blockedState === 'loading') {
      rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading layoutMode="bottom-dock" />)
    } else {
      rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} error={new Error('offline')} layoutMode="bottom-dock" />)
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(container).not.toHaveAttribute('inert')
    if (blockedState === 'error') expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('keeps focus on an external period control when membership changes close expanded Others', async () => {
    // Arrange: Expand desktop Others and move focus to the external period control.
    const user = userEvent.setup()
    const initial = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'])
    const changed = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Theta', 'Iota'])
    const view = (breakdown: ReturnType<typeof breakdownFor>) => (
      <><button type="button">Change period</button><BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" /></>
    )
    const { rerender } = render(view(initial))
    await user.click(screen.getByRole('button', { name: 'Others (2 providers)' }))
    const periodControl = screen.getByRole('button', { name: 'Change period' })
    periodControl.focus()

    // Act: Change selected-period membership while focus remains outside the slab.
    rerender(view(changed))

    // Assert: The disclosure closes without moving focus away from the period control.
    expect(screen.queryByRole('list', { name: 'Other provider totals' })).not.toBeInTheDocument()
    expect(periodControl).toHaveFocus()
  })

  it('describes the aggregate energy, coverage, and spend on the concise mobile trigger', () => {
    // Arrange: More than four known providers create an aggregate mobile Others row.
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'])

    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)

    // Assert: The short accessible name stays concise while all aggregate totals remain available.
    const trigger = screen.getByRole('button', { name: 'Show 3 other providers' })
    expect(trigger).toHaveAccessibleDescription(/Billed energy 6 kWh.*3 of 3 sessions measured.*Session spend 3,00 €/)
  })

  it('restores focus to the live Others row after a layout change closes its sheet', async () => {
    // Arrange: Open the mobile sheet for a group that still exists in sidebar layout.
    const user = userEvent.setup()
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    await user.click(screen.getByRole('button', { name: 'Show 2 other providers' }))

    // Act: Change layout while the mobile trigger is removed and desktop Others remains.
    rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)

    // Assert: The surviving inline Others control receives focus after modal cleanup.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Others (1 provider)' })).toHaveFocus()
  })

  it('restores focus to the provider list when a group change removes the open Others trigger', async () => {
    // Arrange: Open the mobile sheet before replacing its membership with four named providers.
    const user = userEvent.setup()
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'])
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    await user.click(screen.getByRole('button', { name: 'Show 2 other providers' }))

    // Act: Remove the Others group while its modal is open.
    rerender(<BillingProviderBreakdownSlab breakdown={breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta'])} isLoading={false} layoutMode="bottom-dock" />)

    // Assert: Focus moves to the surviving list after the stale modal and trigger are removed.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Provider totals' })).toHaveFocus()
  })

  it('moves focus to the provider list when a layout change removes Others', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    const othersButton = screen.getByRole('button', { name: 'Show 1 other provider' })
    othersButton.focus()

    // Act
    rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)

    // Assert
    expect(screen.queryByRole('button', { name: /Others/ })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Provider totals' })).toHaveFocus()
  })

  it('does not restore focus after focus has already left Others', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const view = (layoutMode: 'bottom-dock' | 'sidebar') => (
      <>
        <button type="button">Outside control</button>
        <BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode={layoutMode} />
      </>
    )
    const { rerender } = render(view('bottom-dock'))
    screen.getByRole('button', { name: 'Show 1 other provider' }).focus()
    const outsideControl = screen.getByRole('button', { name: 'Outside control' })
    outsideControl.focus()

    // Act
    rerender(view('sidebar'))

    // Assert
    expect(outsideControl).toHaveFocus()
    expect(screen.getByRole('list', { name: 'Provider totals' })).not.toHaveFocus()
  })

  it('keeps real __others__ provider identity separate from the synthetic Others group', () => {
    // Arrange
    const breakdown = breakdownFor(['__others__', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)

    // Assert
    expect(screen.getByText('__others__')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 2 other providers' })).toBeInTheDocument()
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/i)
    consoleError.mockRestore()
  })

  it('hides the energy bar for one provider or when no positive energy is measured', () => {
    // Arrange
    const oneProvider = breakdownFor(['Only'])
    const unavailable = calculateBillingProviderBreakdown([{
      id: 'energy-unavailable', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 10 },
      session_timestamp: new Date('2026-07-14T12:00:00Z'), provider_name_snapshot: 'Only',
      charging_type: 'AC', kwh_billed: 0, total_cost: 100, applied_session_fee: 0,
      created_at: new Date('2026-07-14T12:00:00Z'), updated_at: new Date('2026-07-14T12:00:00Z'),
    }], period)

    // Act / Assert
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={oneProvider} isLoading={false} />)
    expect(screen.queryByRole('img', { name: /Billed energy by provider/ })).not.toBeInTheDocument()
    rerender(<BillingProviderBreakdownSlab breakdown={unavailable} isLoading={false} />)
    expect(screen.queryByRole('img', { name: /Billed energy by provider/ })).not.toBeInTheDocument()
  })

  it('explains that no provider distribution is shown when sessions have no positive known energy', () => {
    // Arrange: Sessions exist, but neither provider has a positive billed-energy measurement.
    const unavailable = calculateBillingProviderBreakdown([{
      id: 'zero-energy-a', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 10 },
      session_timestamp: new Date('2026-07-14T12:00:00Z'), provider_name_snapshot: 'Provider A',
      charging_type: 'AC', kwh_billed: 0, total_cost: 100, applied_session_fee: 0,
      created_at: new Date('2026-07-14T12:00:00Z'), updated_at: new Date('2026-07-14T12:00:00Z'),
    }, {
      id: 'zero-energy-b', user_id: 'owner', session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
      plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 10 },
      session_timestamp: new Date('2026-07-14T13:00:00Z'), provider_name_snapshot: 'Provider B',
      charging_type: 'AC', kwh_billed: Number.NaN, total_cost: 100, applied_session_fee: 0,
      created_at: new Date('2026-07-14T13:00:00Z'), updated_at: new Date('2026-07-14T13:00:00Z'),
    }], period)

    // Act
    render(<BillingProviderBreakdownSlab breakdown={unavailable} isLoading={false} />)

    // Assert
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Known billed energy by provider')).toBeInTheDocument()
    expect(screen.queryByText(/\bkWh\b/)).not.toBeInTheDocument()
    expect(screen.getByText('Available for 0 of 2 sessions.')).toBeInTheDocument()
    expect(screen.getByText('No provider distribution is shown because no sessions have positive known billed energy.')).toBeInTheDocument()
  })
})
