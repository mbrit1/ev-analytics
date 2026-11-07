import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateSessionSpendingTrend, type SessionSpendingTrend } from '../model/sessionSpendingTrend'
import { SessionSpendingTrendSlab } from './SessionSpendingTrendSlab'

function StatefulTrendHarness({
  initialMetric = 'spending',
  isLoading = false,
  error = null,
}: {
  initialMetric?: 'spending' | 'energy'
  isLoading?: boolean
  error?: Error | null
}) {
  const [metric, setMetric] = useState<'spending' | 'energy'>(initialMetric)
  return <SessionSpendingTrendSlab period={trendPeriod} trend={energyTrend} isLoading={isLoading} error={error} metric={metric} onMetricChange={setMetric} />
}

function buildSession(timestamp: Date, totalCost: number, id: string): Extract<ChargingSession, { session_mode: 'plan' }> {
  return {
    id,
    user_id: 'user-1',
    session_mode: 'plan',
    provider_id: 'provider-1',
    tariff_plan_id: 'plan-1',
    provider_name_snapshot: 'Recorded provider',
    charging_type: 'AC',
    kwh_billed: 10,
    total_cost: totalCost,
    applied_session_fee: 0,
    session_timestamp: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

const trendPeriod = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 15))
const trend: SessionSpendingTrend = calculateSessionSpendingTrend([
  buildSession(new Date(2026, 1, 1), 0, 'february-zero'),
  buildSession(new Date(2026, 2, 1), 500, 'march-spend'),
  buildSession(new Date(2026, 3, 1), 0, 'april-zero'),
  buildSession(new Date(2026, 4, 1), 0, 'may-zero'),
  buildSession(new Date(2026, 5, 1), Number.NaN, 'june-invalid'),
  buildSession(new Date(2026, 6, 1), 0, 'july-zero'),
], trendPeriod)
const energyTrend: SessionSpendingTrend = {
  ...trend,
  buckets: trend.buckets.map((bucket, index) => ({
    ...bucket,
    billedEnergyKwh: [0.126, 0.2, null, 0, null, 0.02][index] ?? null,
    validBilledEnergySessionCount: [1, 2, 0, 1, 0, 1][index] ?? 0,
    sessionCount: [2, 2, 0, 1, 1, 1][index] ?? 0,
  })),
  isEmpty: false,
}

/** Verifies monthly bar selection and its equivalent accessible values. */
describe('SessionSpendingTrendSlab', () => {
  const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 15))

  it('shows discrete monthly energy with truthful partial and unavailable coverage', () => {
    // Arrange
    render(<SessionSpendingTrendSlab period={period} trend={energyTrend} isLoading={false} metric="energy" onMetricChange={() => {}} />)

    // Assert: The energy view keeps the same date selection and reports coverage separately from missing data.
    expect(screen.getByRole('heading', { name: /Monthly energy/ })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Monthly energy by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('0,02 kWh'))
    expect(screen.getAllByText(/1 of 2 sessions/).length).toBeGreaterThan(1)
    expect(screen.getByText(/Unavailable: no valid billed energy/)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Monthly energy by month' }).querySelector('[data-selected-month-anchor="true"]')).toBeInTheDocument()
    const marks = screen.getByRole('slider', { name: 'Monthly energy by month' }).querySelectorAll('[data-energy-mark]')
    expect([...marks].map((mark) => mark.getAttribute('data-energy-kwh'))).toEqual(['0.126', '0.2', '0', '0.02'])
    const fractionalMark = [...marks].find((mark) => mark.getAttribute('data-energy-kwh') === '0.126')!
    const energyTicks = [...screen.getByRole('group', { name: 'Energy scale in kWh' }).querySelectorAll('[data-axis-label-kwh]')]
    const axisMaximum = Number(energyTicks.at(-1)?.getAttribute('data-axis-label-kwh'))
    expect((Number.parseFloat((fractionalMark as HTMLElement).style.top) / 100) * 220)
      .toBeCloseTo(176 - (0.126 / axisMaximum) * (176 - 58))
    expect(fractionalMark).toHaveClass('h-2.5', 'w-2.5')
    expect(screen.getByRole('slider', { name: 'Monthly energy by month' }).querySelector('polyline, path')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Energy scale in kWh' })).toBeInTheDocument()
  })

  it('visibly qualifies partial energy for uninspected buckets when the values table is closed', () => {
    // Arrange
    render(<SessionSpendingTrendSlab period={period} trend={energyTrend} isLoading={false} metric="energy" onMetricChange={() => {}} />)

    // Assert: Users can associate the subtotal with its measured share without opening the tooltip or table.
    expect(screen.getByText('Partial billed energy · Feb 2026: 1 of 2 sessions measured.')).toBeVisible()
    expect(screen.getByText('View monthly values').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('slider', { name: 'Monthly energy by month' }).querySelector('[data-spending-tooltip="true"]')).not.toBeInTheDocument()
  })

  it('provides a keyboard-operable metric radio group with large focused targets', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<StatefulTrendHarness />)
    const spending = screen.getByRole('radio', { name: 'Spending' })
    const energy = screen.getByRole('radio', { name: 'Energy' })
    expect(spending).toBeChecked()

    // Act: Move through the native radio group using the keyboard.
    await user.tab()
    await user.keyboard('{ArrowRight}')

    // Assert: Selection changes by keyboard and its visible option remains a 44px target.
    expect(energy).toBeChecked()
    expect(energy.closest('label')).toHaveClass('min-h-11')
    expect(energy.closest('label')).toHaveClass('min-w-11')
    expect(energy.closest('label')).toHaveClass('focus-within:ring-2')
    expect(screen.getByRole('slider', { name: 'Monthly energy by month' })).toBeInTheDocument()
  })

  it('preserves the inspected bucket across metric changes and distinguishes empty from unavailable energy', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<StatefulTrendHarness />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.focus(plot)
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(plot).toHaveAttribute('aria-valuenow', '4')

    // Act: Switch the active metric without changing the chart range or inspection index.
    await user.click(screen.getByRole('radio', { name: 'Energy' }))

    // Assert: The same month stays selected and its unavailable coverage is explicit.
    const energyPlot = screen.getByRole('slider', { name: 'Monthly energy by month' })
    expect(energyPlot).toHaveAttribute('aria-valuenow', '4')
    expect(energyPlot).toHaveAttribute('aria-valuetext', expect.stringContaining('0 of 1 sessions'))
    const rows = screen.getByRole('table').querySelectorAll('tbody tr')
    expect(rows[2]).toHaveTextContent('No charging sessions')
    expect(rows[4]).toHaveTextContent('Unavailable: no valid billed energy')
    expect(rows[0]).toHaveTextContent('Partial coverage: 1 of 2 sessions')
    fireEvent.focus(energyPlot)
    expect(energyPlot.querySelector('[data-spending-tooltip="true"]')).toHaveTextContent('0 of 1 sessions')
    fireEvent.keyDown(energyPlot, { key: 'Home' })
    expect(energyPlot).toHaveAttribute('aria-valuetext', expect.stringContaining('Partial coverage: 1 of 2 sessions'))
    expect(energyPlot.querySelector('[data-spending-tooltip="true"]')).toHaveTextContent('Partial coverage: 1 of 2 sessions')
  })

  it('hides stale energy values during loading and errors while keeping the date range accessible', () => {
    // Arrange
    const { rerender } = render(<StatefulTrendHarness initialMetric="energy" />)
    expect(screen.getByRole('table')).toHaveTextContent('kWh')

    // Act: Loading and failed states replace all chart values.
    rerender(<StatefulTrendHarness initialMetric="energy" isLoading />)

    // Assert: The current metric's exact date range remains on the heading.
    expect(screen.getByRole('status')).toHaveTextContent('Loading energy trend')
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly energy (kWh), 1 Feb – 15 Jul 2026' })).toBeInTheDocument()

    // Act and assert: An error also hides the values and retains an accessible heading range.
    rerender(<StatefulTrendHarness initialMetric="energy" error={new Error('offline')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load energy trend')
    expect(screen.queryByText('0,02 kWh')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly energy (kWh), 1 Feb – 15 Jul 2026' })).toBeInTheDocument()
  })

  it('labels the monthly chart and exposes one keyboard slider for month selection', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    expect(screen.getByRole('heading', { name: 'Monthly spending (EUR), 1 Feb – 15 Jul 2026' })).toBeInTheDocument()
    expect(document.querySelector('summary[aria-label="Info"]')).toBeInTheDocument()
    expect(screen.getByText('1 Feb – 15 Jul 2026 · 6 Months context')).toBeInTheDocument()
    expect(document.querySelector('caption')).toHaveTextContent('Monthly session spending values for 1 Feb 2026 – 15 Jul 2026')
    expect(screen.queryByText(/Chart range/)).not.toBeInTheDocument()
    expect(screen.getByText('MTD: month to date.')).toBeInTheDocument()
    expect(screen.queryByText('* Partial month')).not.toBeInTheDocument()
    expect(screen.getAllByText('Jul · MTD').length).toBeGreaterThan(0)
    expect(screen.queryByText('Jul*')).not.toBeInTheDocument()
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })

    // Act
    await user.tab()
    await user.tab()
    await user.tab()
    expect(plot).toHaveFocus()
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('Month to date'))
    await user.keyboard('{Home}')
    await user.keyboard('{ArrowRight}')

    // Assert
    expect(plot).toHaveAttribute('aria-valuenow', '1')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('1 Mar 2026 – 31 Mar 2026'))
    expect(plot.querySelector('[data-selected-month-anchor="true"]')).toBeInTheDocument()
    const tooltip = plot.querySelector('[data-spending-tooltip="true"]')!
    expect(tooltip.children).toHaveLength(2)
    expect(tooltip.children[0]).toHaveTextContent('Mar 2026 · 5,00 €')
    expect(tooltip.children[1]).toHaveTextContent('1–31 Mar')
    expect(tooltip.children[1]).not.toHaveTextContent('Complete month')
    await user.keyboard('{End}')
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Jul 2026 · 0,00 €')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–15 Jul · Month to date')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).not.toHaveTextContent('Partial month')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringMatching(/1 Jul 2026.*15 Jul 2026.*Month to date/))
    expect(plot.querySelector('[data-selected-month-anchor="true"]')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    await user.keyboard('{Home}')
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Feb 2026 · 0,00 €')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–28 Feb')
    await user.keyboard('{ArrowLeft}')
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows the exact three-month chart range when a short selected period has wider context', () => {
    // Arrange: A seven-day summary ends today while its chart context spans three months.
    const now = new Date(2026, 2, 10, 12)
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now)
    const chartPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, now)
    const contextTrend = calculateSessionSpendingTrend([], chartPeriod)!

    // Act: Render the short summary period with its wider chart context.
    render(<SessionSpendingTrendSlab period={period} trend={contextTrend} isLoading={false} />)

    // Assert: The chart heading and quiet label identify the exact three-month coverage.
    expect(screen.getByRole('heading', { name: 'Monthly spending (EUR), 11 Dec 2025 – 10 Mar 2026' })).toBeInTheDocument()
    expect(screen.getByText('11 Dec 2025 – 10 Mar 2026 · 3 Months context')).toBeInTheDocument()
    expect(screen.queryByText('4 Mar – 10 Mar 2026')).not.toBeInTheDocument()
  })

  it('labels a calendar-month chart from its six actual context months', () => {
    // Arrange: June is selected, so the chart begins on January 1 while the summary starts in June.
    const monthPeriod = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const sixMonthTrend = calculateSessionSpendingTrend([], monthPeriod)

    // Act
    render(<SessionSpendingTrendSlab period={monthPeriod} trend={sixMonthTrend} isLoading={false} />)

    // Assert: Exact accessible dates and the visible context description match actual chart bounds.
    expect(screen.getByRole('heading', { name: 'Monthly spending (EUR), 1 Jan – 30 Jun 2026' })).toBeInTheDocument()
    expect(screen.getByText('1 Jan – 30 Jun 2026 · 6 Months context')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('1 Jun 2026 – 30 Jun 2026'))
  })

  it('preserves the inspected bucket when 7-day and 30-day summaries share chart bounds', () => {
    // Arrange: Both short summaries map to the same three-month chart window.
    const now = new Date(2026, 5, 10, 12)
    const sevenDays = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now)
    const thirtyDays = createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, now)
    const chartPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, now)
    const sharedTrend = calculateSessionSpendingTrend([], chartPeriod)!
    const { rerender } = render(<SessionSpendingTrendSlab period={sevenDays} trend={sharedTrend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.focus(plot)
    fireEvent.keyDown(plot, { key: 'End' })
    expect(plot).toHaveAttribute('aria-valuenow', `${sharedTrend.buckets.length - 1}`)

    // Act: Change only the selected summary period while retaining the chart bounds.
    rerender(<SessionSpendingTrendSlab period={thirtyDays} trend={sharedTrend} isLoading={false} />)

    // Assert: Inspection remains at the same chart bucket after the summary scope changes.
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuenow', `${sharedTrend.buckets.length - 1}`)
  })

  it('renders a zero-based compact EUR axis with rounded ticks that cover the highest value', () => {
    // Arrange
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)

    // Assert: The 6,00 € maximum is covered by a short, evenly stepped scale beginning at zero.
    const axis = screen.getByRole('group', { name: 'Spending scale in euros' })
    const axisLabels = [...axis.querySelectorAll('[data-axis-label-cents]')]
    const tickLabels = axisLabels.map((tick) => tick.textContent)
    expect(tickLabels.length).toBeGreaterThanOrEqual(3)
    expect(tickLabels[0]).toBe('0,00 €')
    expect(tickLabels.at(-1)).toBe('6,00 €')
    expect(tickLabels).toEqual(['0,00 €', '2,00 €', '4,00 €', '6,00 €'])
    const axisLines = [...screen.getByRole('slider', { name: 'Monthly spending by month' }).querySelectorAll('[data-axis-tick-cents]')]
    expect(axisLines).toHaveLength(axisLabels.length)
    axisLabels.forEach((label) => {
      const cents = label.getAttribute('data-axis-label-cents')
      const matchingLine = screen.getByRole('slider', { name: 'Monthly spending by month' }).querySelector(`[data-axis-tick-cents="${cents}"]`)
      const labelY = (Number.parseFloat((label as HTMLElement).style.top) / 100) * 220
      expect(labelY).toBeCloseTo(Number(matchingLine?.getAttribute('y1')))
    })
  })

  it('reveals the selected tooltip only while the chart is inspected and dismisses it on Escape or blur', async () => {
    // Arrange
    const user = userEvent.setup()
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    expect(plot.querySelector('[data-spending-tooltip="true"]')).not.toBeInTheDocument()

    // Act: Focus reveals the selected value, and Escape dismisses it without moving the selection.
    await user.tab()
    await user.tab()
    await user.tab()
    expect(plot.querySelector('[data-spending-tooltip="true"]')).toHaveTextContent('Jul 2026 · 0,00 €')
    await user.keyboard('{Escape}')

    // Assert
    expect(plot.querySelector('[data-spending-tooltip="true"]')).not.toBeInTheDocument()
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    fireEvent.focus(plot)
    expect(plot.querySelector('[data-spending-tooltip="true"]')).toBeInTheDocument()
    fireEvent.blur(plot)
    expect(plot.querySelector('[data-spending-tooltip="true"]')).not.toBeInTheDocument()

    // Act: Arrow-key inspection reopens it; changing the range returns to a hidden initial state.
    fireEvent.focus(plot)
    await user.keyboard('{ArrowLeft}')
    expect(plot.querySelector('[data-spending-tooltip="true"]')).toHaveTextContent('Jun 2026 · Unavailable')
    const nextPeriod = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 15))
    const nextTrend = calculateSessionSpendingTrend([], nextPeriod)!
    rerender(<SessionSpendingTrendSlab period={nextPeriod} trend={nextTrend} isLoading={false} />)
    expect(plot.querySelector('[data-spending-tooltip="true"]')).not.toBeInTheDocument()
  })

  it('opens the recorded-charge explanation from its keyboard-accessible info disclosure', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const info = document.querySelector('summary[aria-label="Info"]')!

    // Act
    expect(info.closest('details')).not.toHaveAttribute('open')
    expect(info).toHaveClass('min-h-11')
    await user.tab()
    await user.tab()
    expect(info).toHaveFocus()
    await user.keyboard('{Enter}')

    // Assert
    expect(info.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Recorded session charges; excludes subscription fees')).toBeVisible()
  })

  it('selects monthly bars by pointer without giving zero or unavailable values positive height', () => {
    // Arrange
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    Object.defineProperty(plot.querySelector('svg')!, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 500, bottom: 160, width: 500, height: 160, x: 0, y: 0, toJSON: () => {} }),
    })

    // Act: A pointer outside the plotted SVG, such as in the label gutter, is not a chart hit.
    fireEvent.pointerDown(plot, { clientX: -1, clientY: 80, pointerId: 1 })
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot.querySelector('[data-spending-tooltip="true"]')).not.toBeInTheDocument()

    // Act: Select the unavailable and zero-spend buckets by pointer.
    fireEvent.pointerDown(plot, { clientX: 400, clientY: 80, pointerId: 1, pointerType: 'touch' })

    // Assert: The null bucket stays unavailable and opens no invented point.
    expect(plot).toHaveAttribute('aria-valuenow', '4')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('Unavailable'))
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Jun 2026 · Unavailable')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–30 Jun')
    expect(plot).toHaveFocus()
    fireEvent.pointerMove(plot, { clientX: 490, clientY: 80, pointerId: 1, pointerType: 'touch', buttons: 1 })
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    fireEvent.pointerDown(plot, { clientX: 400, clientY: 80, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerDown(plot, { clientX: 490, clientY: 80, pointerId: 1, button: 2 })
    expect(plot).toHaveAttribute('aria-valuenow', '4')
    fireEvent.pointerDown(plot, { clientX: 0, clientY: 80, pointerId: 1 })
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Feb 2026 · 0,00 €')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–28 Feb')

    // Act: Select the far-right point using the plot's large hit area.
    fireEvent.pointerDown(plot, { clientX: 490, clientY: 80, pointerId: 1 })

    // Assert: Selection remains inspectable without plotting unavailable values.
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Jul 2026 · 0,00 €')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–15 Jul · Month to date')
    const bars = [...plot.querySelectorAll('[data-month-bar="true"]')]
    expect(bars).toHaveLength(6)
    expect(bars[0]).toHaveAttribute('data-spend-cents', '0')
    expect(bars[0]).toHaveAttribute('data-bar-height', '0')
    expect(bars[4]).toHaveAttribute('data-spend-cents', 'unavailable')
    expect(bars[4]).toHaveAttribute('data-bar-height', '0')
    expect(plot.querySelector('[data-selected-month-anchor="true"]')).toBeInTheDocument()
  })

  it('shows exact covered dates and partial-month metadata in a collapsed monthly values disclosure', async () => {
    // Arrange
    const user = userEvent.setup()
    const partialTrend: SessionSpendingTrend = {
      startUtc: new Date(2023, 11, 11),
      endUtc: new Date(2024, 0, 1),
      selectedMonth: null,
      unit: 'month',
      isEmpty: false,
      buckets: [{
        startUtc: new Date(2023, 11, 11),
        endUtc: new Date(2024, 0, 1),
        totalSessionSpendCents: 1234,
        billedEnergyKwh: 12.5,
        validBilledEnergySessionCount: 2,
        averageSessionPriceCtPerKwh: 98.72,
        sessionCount: 2,
        unit: 'month',
        month: { year: 2023, month: 11 },
        isCurrentMonth: false,
        isPartialMonth: true,
      }],
    }
    render(<SessionSpendingTrendSlab period={period} trend={partialTrend} isLoading={false} />)

    // Act
    const disclosure = screen.getByText('View monthly values').closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('Dec 2023, 11 Dec 2023 – 31 Dec 2023, Partial month, 2 sessions, 12,34 €'))
    expect(screen.getByRole('table', { hidden: true })).not.toBeVisible()
    await user.click(screen.getByText('View monthly values'))

    // Assert
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('Dec 2023, 11 Dec 2023 – 31 Dec 2023, Partial month, 2 sessions, 12,34 €'))
    expect(within(screen.getByRole('table')).getByRole('row', { name: /11 Dec 2023 – 31 Dec 2023 · Partial month 2 12,34 €/ })).toBeInTheDocument()
  })

  it('distinguishes loading, failure, empty period, free sessions, and unavailable buckets', () => {
    // Arrange / Act: Render each state independently.
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading spending trend')
    rerender(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} error={new Error('offline')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load spending trend')
    const emptyTrend = { ...trend, buckets: trend.buckets.map((bucket) => ({ ...bucket, totalSessionSpendCents: 0, sessionCount: 0 })), isEmpty: true }
    rerender(<SessionSpendingTrendSlab period={period} trend={emptyTrend} isLoading={false} />)
    expect(screen.getByText('No charging sessions recorded for this chart range.')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toBeInTheDocument()
    expect(screen.getByText('1 Feb – 15 Jul 2026 · 6 Months context')).toBeInTheDocument()
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [trend.buckets[0]!], isEmpty: false }} isLoading={false} />)

    // Assert
    expect(screen.getByText('Recorded sessions in this period were free (0,00 €).')).toBeInTheDocument()
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [trend.buckets[4]!], isEmpty: false }} isLoading={false} />)
    expect(screen.queryByText('* Partial month')).not.toBeInTheDocument()
    expect(screen.queryByText('MTD: month to date.')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Unavailable: at least one session has an invalid recorded cost/).length).toBeGreaterThan(0)
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('Jun 2026, 1 Jun 2026 – 30 Jun 2026, Complete month, 1 session, Unavailable'))
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('invalid recorded cost'))
    const unavailablePlot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.focus(unavailablePlot)
    expect(unavailablePlot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Jun 2026 · Unavailable')
    expect(unavailablePlot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–30 Jun')
    expect(within(screen.getByRole('table', { hidden: true })).getByRole('cell', { name: /invalid recorded cost/ })).toBeInTheDocument()
  })

  it('resets the selected bucket when the period changes', async () => {
    // Arrange
    const user = userEvent.setup()
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    await user.click(plot)
    await user.keyboard('{Home}{ArrowRight}')
    expect(plot).toHaveAttribute('aria-valuenow', '1')

    // Act
    const nextPeriod = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 15))
    const nextTrend = calculateSessionSpendingTrend([], nextPeriod)!
    rerender(<SessionSpendingTrendSlab period={nextPeriod} trend={nextTrend} isLoading={false} />)

    // Assert
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('1 Jun 2026'))
  })

  it('resets inspection to the selected-month anchor when chart bounds change independently', async () => {
    // Arrange
    const user = userEvent.setup()
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    await user.click(plot)
    await user.keyboard('{Home}')
    expect(plot).toHaveAttribute('aria-valuenow', '0')

    // Act: Keep the summary period while the model returns a refreshed wider chart range.
    const updatedTrend = { ...trend, startUtc: new Date(2026, 0, 1) }
    rerender(<SessionSpendingTrendSlab period={period} trend={updatedTrend} isLoading={false} />)

    // Assert: The inspected month returns to July and the summary month stays marked independently.
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringMatching(/1 Jul 2026.*15 Jul 2026.*Month to date/))
    expect(plot.querySelector('[data-selected-month-anchor="true"]')).toBeInTheDocument()
  })

  it('resets to each newly entered range anchor, including when returning to an earlier range', () => {
    // Arrange: Inspect an earlier month in range A, then visit B without interacting with it.
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    const rangeB = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 15))
    const trendB = calculateSessionSpendingTrend([], rangeB)!

    // Act: Enter B, then return to A.
    rerender(<SessionSpendingTrendSlab period={rangeB} trend={trendB} isLoading={false} />)
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    rerender(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)

    // Assert: Returning to A initializes its selected-month anchor again.
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringMatching(/1 Jul 2026.*15 Jul 2026.*Month to date/))
  })

  it('retains inspection after data refreshes within the same chart range', () => {
    // Arrange
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.keyDown(plot, { key: 'Home' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    expect(plot).toHaveAttribute('aria-valuenow', '1')

    // Act: Refresh values while all range identity fields stay unchanged.
    const refreshedTrend = { ...trend, buckets: trend.buckets.map((bucket) => ({ ...bucket, totalSessionSpendCents: 900 })) }
    rerender(<SessionSpendingTrendSlab period={period} trend={refreshedTrend} isLoading={false} />)

    // Assert
    expect(plot).toHaveAttribute('aria-valuenow', '1')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('9,00 €'))
  })

  it('announces full selected month details once as keyboard inspection changes', () => {
    // Arrange
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })

    // Act: Inspect the invalid-cost month.
    fireEvent.keyDown(plot, { key: 'Home' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })

    // Assert: The single polite announcement includes month, exact dates, count and why spend is unavailable.
    const announcements = document.querySelectorAll('[aria-live="polite"]')
    expect(announcements).toHaveLength(1)
    expect(announcements[0]).toHaveTextContent('Jun 2026, 1 Jun 2026 – 30 Jun 2026, Complete month, 1 session, Unavailable: at least one session has an invalid recorded cost')
  })

  it('keeps a 13-month rolling range readable with labeled endpoints and midpoint', () => {
    // Arrange: A calendar year preset produces 13 monthly positions across the year boundary.
    const yearPeriod = createAnalyticsPeriod({ kind: 'preset', preset: 'year' }, new Date(2026, 6, 15))
    const yearTrend = calculateSessionSpendingTrend([], yearPeriod)!

    // Act
    render(<SessionSpendingTrendSlab period={yearPeriod} trend={yearTrend} isLoading={false} />)

    // Assert: All buckets remain available through the slider/table and sparse labels retain month/year.
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    expect(plot).toHaveAttribute('aria-valuemax', '12')
    expect(screen.queryByText(/context/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly spending (EUR), 16 Jul 2025 – 15 Jul 2026' })).toBeInTheDocument()
    expect(screen.getAllByText('Jul*').length).toBeGreaterThan(0)
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Jul · MTD')).toBeInTheDocument()
    expect(screen.getByText('* Partial month · MTD: month to date.')).toBeInTheDocument()
    expect(screen.getByText('View monthly values')).toBeInTheDocument()
    expect(within(screen.getByText('Jul*').parentElement!).getByText('2025')).toBeInTheDocument()
    expect(within(screen.getByText('Jul · MTD').parentElement!).getByText('2026')).toBeInTheDocument()
    expect(screen.getByText('Jul*').parentElement).not.toHaveTextContent(/\d{1,2} [A-Z][a-z]{2} 202\d – \d{1,2} [A-Z][a-z]{2} 202\d/)
  })

  it('shows partial and current-month guidance for a real short-period chart context', () => {
    // Arrange: A seven-day summary on October 9 produces a clipped July bucket and current October bucket.
    const shortPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date(2024, 9, 9, 12))
    const partialTrend = calculateSessionSpendingTrend([], shortPeriod)

    // Act
    render(<SessionSpendingTrendSlab period={shortPeriod} trend={partialTrend} isLoading={false} />)

    // Assert
    expect(screen.getByText('10 Jul – 9 Oct 2024 · 3 Months context')).toBeInTheDocument()
    expect(screen.getByText('* Partial month · MTD: month to date.')).toBeInTheDocument()
    expect(screen.getAllByText('Jul*').length).toBeGreaterThan(0)
    expect([...document.querySelectorAll('p')].some(({ textContent }) => textContent?.includes('Jul 2024 · Partial month'))).toBe(false)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.focus(plot)
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Jul 2024 · 0,00 €')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('10–31 Jul · Partial month')
  })

  it('shows both years when the quiet chart range crosses a year boundary', () => {
    // Arrange: The real seven-day period crosses a year while its chart expands to three months.
    const shortPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date(2026, 0, 8, 12))
    const yearBoundaryTrend = calculateSessionSpendingTrend([], shortPeriod)

    // Act
    render(<SessionSpendingTrendSlab period={shortPeriod} trend={yearBoundaryTrend} isLoading={false} />)

    // Assert
    expect(screen.getByText('9 Oct 2025 – 8 Jan 2026 · 3 Months context')).toBeInTheDocument()
    expect(within(screen.getAllByText('Oct*')[0]!.parentElement!).getByText('2025')).toBeInTheDocument()
    expect(within(screen.getAllByText('Jan · MTD')[0]!.parentElement!).getByText('2026')).toBeInTheDocument()
  })
})
