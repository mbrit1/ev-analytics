import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateBillingProviderBreakdown } from '../model/billingProviderBreakdown'
import { BillingProviderBreakdownSlab } from './BillingProviderBreakdownSlab'

/** Test suite for selected-period provider totals and coverage states. */
describe('BillingProviderBreakdownSlab', () => {
  const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date('2026-07-15T12:00:00Z'))

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
    expect(screen.getAllByText(/12,5/)).toHaveLength(2)
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
    expect(screen.getByText(/1\/2 measured/)).toBeInTheDocument()
    expect(screen.getByText('Free Provider')).toBeInTheDocument()
    expect(screen.getByText('Free', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable', { selector: 'p' })).toHaveLength(2)
    expect(screen.getByText(/Energy unavailable/)).toBeInTheDocument()
  })
})
