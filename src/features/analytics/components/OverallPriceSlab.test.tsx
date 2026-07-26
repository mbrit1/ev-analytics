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

function renderSlab(
  result: OverallChargingPriceResult,
  layoutMode: 'sidebar' | 'bottom-dock' = 'sidebar',
) {
  const onAddSession = vi.fn()
  const onReviewTariffs = vi.fn()
  const user = userEvent.setup()

  render(
    <OverallPriceSlab
      result={result}
      layoutMode={layoutMode}
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
    const amount = screen.getByText('0,51')
    expect(amount).toHaveClass('tabular-nums')
    expect(amount).toHaveAttribute('aria-hidden', 'true')
    const unit = screen.getByText('€/kWh')
    expect(unit).toHaveAttribute('aria-hidden', 'true')
    expect(unit.parentElement).toBe(amount.parentElement)
    expect(screen.getByText(
      'Overall price: 0,51 euros per kilowatt-hour',
    )).toHaveClass('sr-only')
    expect(screen.getByText('Effective price including applicable fixed costs')).toBeInTheDocument()
    expect(screen.getByText('Billed energy')).toBeInTheDocument()
    expect(screen.getByText('129,2', { exact: false })).toHaveClass('tabular-nums')
    expect(screen.getByText('Included spend')).toBeInTheDocument()
    expect(screen.getByText('66,15 €')).toHaveClass('tabular-nums')
    const heading = screen.getByRole('heading', { name: 'Overall price' })
    expect(heading).toHaveClass('whitespace-nowrap')
    expect(heading.parentElement)
      .toHaveClass('flex', 'items-center', 'gap-1')
  })

  it('passes the active bottom-dock layout through to the calculation disclosure', async () => {
    // Arrange: Render the KPI in its compact Analytics composition.
    const { user } = renderSlab(readyResult, 'bottom-dock')

    // Act: Open the calculation explanation.
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Assert: The slab delegates its adaptive surface to the modal disclosure.
    expect(screen.getByRole('dialog', { name: 'How Overall Price is calculated' }))
      .toHaveAttribute('aria-modal', 'true')
  })

  it('uses a semantic loading placeholder without exposing a stale calculation', async () => {
    // Arrange / Act: Refresh while a previous ready calculation remains available.
    const user = userEvent.setup()
    const { container } = render(
      <OverallPriceSlab
        result={readyResult}
        isLoading
        layoutMode="sidebar"
        onAddSession={vi.fn()}
        onReviewTariffs={vi.fn()}
      />,
    )

    // Assert: The loading state is announced and does not present old KPI values.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Loading Overall Price')).toHaveClass('sr-only')
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('51,2 ct/kWh')).not.toBeInTheDocument()
    expect(screen.queryByText('0,51')).not.toBeInTheDocument()
    expect(screen.queryByText('66,15 €')).not.toBeInTheDocument()

    // Act: Open the disclosure while the refreshed result is still loading.
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Assert: No stale higher-precision value is supplied during loading.
    expect(screen.queryByText(/Higher-precision price:/)).not.toBeInTheDocument()
  })

  it('passes the ready cents rate to the calculation disclosure', async () => {
    // Arrange: Render a trustworthy ready calculation.
    const user = userEvent.setup()
    renderSlab(readyResult)

    // Act: Open the calculation disclosure.
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Assert: The disclosure receives the raw rate and presents its precision.
    expect(screen.getByText('Higher-precision price: 51,2 ct/kWh')).toBeInTheDocument()
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
