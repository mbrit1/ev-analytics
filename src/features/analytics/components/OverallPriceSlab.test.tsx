import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OverallChargingPriceResult } from '../model/overallChargingPrice'
import { OverallPriceSlab } from './OverallPriceSlab'

const readyResult: OverallChargingPriceResult = {
  status: 'ready',
  sessionCount: 3,
  billedEnergyKwh: 129.2,
  sessionSpendCents: 5000,
  fixedCostCents: 1615,
  includedSpendCents: 6615,
  overallPriceCtPerKwh: 6615 / 129.2,
}

function renderSlab(result: OverallChargingPriceResult) {
  const onAddSession = vi.fn()
  const onReviewTariffs = vi.fn()
  const user = userEvent.setup()

  render(
    <OverallPriceSlab
      result={result}
      onAddSession={onAddSession}
      onReviewTariffs={onReviewTariffs}
    />,
  )

  return { onAddSession, onReviewTariffs, user }
}

/**
 * Test suite for the lifetime Overall Price Floating Slab.
 *
 * Verifies the trustworthy result hierarchy, action callbacks, unavailable
 * diagnostics, and accessible primary/supporting values.
 */
describe('OverallPriceSlab', () => {
  it('renders the ready KPI hierarchy with accessible tabular metrics', () => {
    // Arrange / Act: Render a complete lifetime calculation.
    renderSlab(readyResult)

    // Assert: Primary and supporting metrics remain distinct and fully labelled.
    expect(screen.getByRole('heading', { name: 'Overall price', level: 2 })).toBeInTheDocument()
    const rate = screen.getByText('51,2 ct/kWh')
    expect(rate).toHaveClass('tabular-nums', 'whitespace-nowrap', 'leading-none')
    expect(rate).toHaveAttribute(
      'aria-label',
      'Overall price: 51,2 cents per kilowatt-hour',
    )
    expect(screen.getByText('Effective price including applicable fixed costs')).toBeInTheDocument()
    expect(screen.getByText('Billed energy')).toBeInTheDocument()
    expect(screen.getByText('129,2', { exact: false })).toHaveClass('tabular-nums')
    expect(screen.getByText('Included spend')).toBeInTheDocument()
    expect(screen.getByText('66,15 €')).toHaveClass('tabular-nums')
  })

  it('uses a semantic loading placeholder without exposing a stale calculation', () => {
    // Arrange / Act: Refresh while a previous ready calculation remains available.
    const { container } = render(
      <OverallPriceSlab
        result={readyResult}
        isLoading
        onAddSession={vi.fn()}
        onReviewTariffs={vi.fn()}
      />,
    )

    // Assert: The loading state is announced and does not present old KPI values.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Loading Overall Price')).toHaveClass('sr-only')
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('51,2 ct/kWh')).not.toBeInTheDocument()
    expect(screen.queryByText('66,15 €')).not.toBeInTheDocument()
  })

  it('renders the empty state and invokes the supplied add-session action', async () => {
    // Arrange: Render an empty lifetime result.
    const { onAddSession, user } = renderSlab({ status: 'empty' })

    // Act: Select the existing entry action.
    await user.click(screen.getByRole('button', { name: 'Add Session' }))

    // Assert: The empty state explains the absence without false zero metrics.
    expect(screen.getByText('No price available')).toBeInTheDocument()
    expect(screen.getByText('Add a charging session to calculate your overall energy price.'))
      .toBeInTheDocument()
    expect(screen.queryByText(/ct\/kWh/)).not.toBeInTheDocument()
    expect(onAddSession).toHaveBeenCalledOnce()
  })

  it.each([
    [
      { status: 'unavailable', reason: 'invalid_billed_energy' } as const,
      'One or more charging sessions has invalid provider-billed energy.',
    ],
    [
      { status: 'unavailable', reason: 'missing_tariff_history' } as const,
      'Tariff history for one or more charging sessions is incomplete.',
    ],
  ])('renders the %s unavailable detail without a false zero', (result, detail) => {
    // Arrange / Act: Render one trusted-unavailable result variant.
    renderSlab(result)

    // Assert: The failure is explicit rather than represented as a zero rate.
    expect(screen.getByText('Overall price unavailable')).toBeInTheDocument()
    expect(screen.getByText(detail)).toBeInTheDocument()
    expect(screen.queryByText(/0 ct\/kWh/)).not.toBeInTheDocument()
    expect(screen.queryByText('0,00 €')).not.toBeInTheDocument()
  })

  it('describes the first tariff conflict, count, and review action', async () => {
    // Arrange: Render three deterministically ordered overlap conflicts.
    const result: OverallChargingPriceResult = {
      status: 'unavailable',
      reason: 'overlapping_paid_tariffs',
      conflicts: [
        {
          providerId: 'provider-enbw',
          tariffNames: ['EnBW L', 'EnBW M'],
          month: '2026-07',
        },
        {
          providerId: 'provider-ionity',
          tariffNames: ['Ionity Go', 'Ionity Motion'],
          month: '2026-08',
        },
        {
          providerId: 'provider-foo',
          tariffNames: ['A', 'B'],
          month: '2026-09',
        },
      ],
    }
    const { onReviewTariffs, user } = renderSlab(result)

    // Act: Use the remediation action.
    await user.click(screen.getByRole('button', { name: 'Review tariffs' }))

    // Assert: The primary conflict and remaining deterministic count are visible.
    expect(screen.getByText('Tariff dates overlap for EnBW L and EnBW M in July 2026.'))
      .toBeInTheDocument()
    expect(screen.getByText('and 2 more')).toBeInTheDocument()
    expect(screen.getByText('Update their active dates to calculate Overall Price.'))
      .toBeInTheDocument()
    expect(onReviewTariffs).toHaveBeenCalledOnce()
  })
})
