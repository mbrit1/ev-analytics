import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateBillingProviderBreakdown } from '../model/billingProviderBreakdown'
import { BillingProviderBreakdownSlab } from './BillingProviderBreakdownSlab'

/** Test suite for selected-period provider totals and coverage states. */
describe('BillingProviderBreakdownSlab', () => {
  const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date('2026-07-15T12:00:00Z'))

  function breakdownFor(names: string[], partialProviderName?: string) {
    const sessions = names.map((name, index) => ({
      id: `provider-session-${index}`, user_id: 'owner', session_mode: 'ad_hoc' as const,
      provider_id: null, tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc' as const,
      ad_hoc_pricing: { pricePerKwh: 10 }, session_timestamp: new Date(`2026-07-14T${String(index).padStart(2, '0')}:00:00Z`),
      provider_name_snapshot: name, charging_type: 'AC' as const, kwh_billed: names.length - index,
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

  it('shows European spend, billed energy, and provider rows', () => {
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
    expect(screen.getAllByText('32,50 €')).toHaveLength(2)
    expect(screen.getAllByText(/12,5/)).toHaveLength(3)
    expect(screen.getByText('Example Charge')).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Known billed energy' })).toBeInTheDocument()
    expect(screen.getAllByText(/1\/2 measured/)).toHaveLength(2)
    expect(screen.getByText('Free Provider')).toBeInTheDocument()
    expect(screen.getByText('Free', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable', { selector: 'p' })).toHaveLength(3)
    expect(screen.getByText(/Energy unavailable/)).toBeInTheDocument()
  })

  it('uses the layout limit and expands Others without changing the collapsed subtotal', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], 'Epsilon')

    // Act
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)

    // Assert
    expect(screen.getByRole('img', { name: /Alpha 6 kWh, Beta 5 kWh, Gamma 4 kWh, Others 6 kWh/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Others \(3 providers\)/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Delta')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Others \(3 providers\)/ }))
    expect(screen.getByRole('button', { name: /Others \(3 providers\)/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: 'Other provider totals' })).toBeInTheDocument()
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.getByText('1/2 measured')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Others 6 kWh/ })).toBeInTheDocument()

    rerender(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="sidebar" />)
    expect(screen.getByRole('img', { name: /Alpha 6 kWh, Beta 5 kWh, Gamma 4 kWh, Delta 3 kWh, Epsilon 2 kWh, Others 1 kWh/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Others (1 provider)' })).toBeInTheDocument()
    expect(screen.getByText('1/2 measured')).toBeInTheDocument()
  })

  it('moves focus to the provider list when a layout change removes Others', () => {
    // Arrange
    const breakdown = breakdownFor(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    const { rerender } = render(<BillingProviderBreakdownSlab breakdown={breakdown} isLoading={false} layoutMode="bottom-dock" />)
    const othersButton = screen.getByRole('button', { name: /Others \(2 providers\)/ })
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
    screen.getByRole('button', { name: /Others/ }).focus()
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
    expect(screen.getByRole('button', { name: /Others \(3 providers\)/ })).toBeInTheDocument()
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
    expect(screen.getByText('No provider distribution is shown because no sessions have positive known billed energy.')).toBeInTheDocument()
  })
})
