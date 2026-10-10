import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateSessionSpendingTrend, type SessionSpendingTrend } from '../model/sessionSpendingTrend'
import { SessionSpendingTrendSlab } from './SessionSpendingTrendSlab'

const bucketDates = [0, 1, 2, 3, 4, 5, 6, 7].map((month) => new Date(2026, month, 1))
const bucketValues = [0, 500, null, 0, 600, 0] as const
const trend: SessionSpendingTrend = {
  startUtc: bucketDates[1]!,
  endUtc: new Date(2026, 6, 16),
  selectedMonth: { year: 2026, month: 6 },
  unit: 'month',
  isEmpty: false,
  buckets: bucketValues.map((totalSessionSpendCents, index) => ({
    startUtc: bucketDates[index + 1]!, endUtc: index === 5 ? new Date(2026, 6, 16) : bucketDates[index + 2]!, totalSessionSpendCents,
    sessionCount: 1,
    unit: 'month' as const, month: { year: 2026, month: index + 1 },
    isCurrentMonth: index === 5, isPartialMonth: index === 5,
  })),
}

/** Verifies monthly bar selection and its equivalent accessible values. */
describe('SessionSpendingTrendSlab', () => {
  const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 15))

  it('labels the monthly chart and exposes one keyboard slider for month selection', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    expect(screen.getByRole('heading', { name: 'Session spending' })).toBeInTheDocument()
    expect(document.querySelector('summary[aria-label="Info"]')).toBeInTheDocument()
    expect(screen.getByText('1 Feb – 15 Jul 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Chart range/)).not.toBeInTheDocument()
    expect(screen.getByText('MTD: month to date.')).toBeInTheDocument()
    expect(screen.queryByText('* Partial month')).not.toBeInTheDocument()
    expect(screen.getAllByText('Jul · MTD').length).toBeGreaterThan(0)
    expect(screen.queryByText('Jul*')).not.toBeInTheDocument()
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })

    // Act
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
    expect(plot.querySelector('[data-spending-tooltip="true"]')).toHaveTextContent('Jun 2026 · 6,00 €')
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
    fireEvent.pointerDown(plot, { clientX: 208, clientY: 80, pointerId: 1, pointerType: 'touch' })

    // Assert: The null bucket stays unavailable and opens no invented point.
    expect(plot).toHaveAttribute('aria-valuenow', '2')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('Unavailable'))
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Apr 2026 · Unavailable')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–30 Apr')
    expect(plot).toHaveFocus()
    fireEvent.pointerMove(plot, { clientX: 490, clientY: 80, pointerId: 1, pointerType: 'touch', buttons: 1 })
    expect(plot).toHaveAttribute('aria-valuenow', '5')
    fireEvent.pointerDown(plot, { clientX: 208, clientY: 80, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerDown(plot, { clientX: 490, clientY: 80, pointerId: 1, button: 2 })
    expect(plot).toHaveAttribute('aria-valuenow', '2')
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
    expect(bars[2]).toHaveAttribute('data-spend-cents', 'unavailable')
    expect(bars[2]).toHaveAttribute('data-bar-height', '0')
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
    expect(screen.getByText('No charging sessions recorded for this period.')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toBeInTheDocument()
    expect(screen.getByText('1 Feb – 15 Jul 2026')).toBeInTheDocument()
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [trend.buckets[0]!], isEmpty: false }} isLoading={false} />)

    // Assert
    expect(screen.getByText('Recorded sessions in this period were free (0,00 €).')).toBeInTheDocument()
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [trend.buckets[2]!], isEmpty: false }} isLoading={false} />)
    expect(screen.queryByText('* Partial month')).not.toBeInTheDocument()
    expect(screen.queryByText('MTD: month to date.')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Unavailable: at least one session has an invalid recorded cost/).length).toBeGreaterThan(0)
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('Apr 2026, 1 Apr 2026 – 30 Apr 2026, Complete month, 1 session, Unavailable'))
    expect(screen.getByRole('slider', { name: 'Monthly spending by month' })).toHaveAttribute('aria-valuetext', expect.stringContaining('invalid recorded cost'))
    const unavailablePlot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.focus(unavailablePlot)
    expect(unavailablePlot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Apr 2026 · Unavailable')
    expect(unavailablePlot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('1–30 Apr')
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

    // Assert: The single polite announcement includes month, exact dates, count and why spend is unavailable.
    const announcements = document.querySelectorAll('[aria-live="polite"]')
    expect(announcements).toHaveLength(1)
    expect(announcements[0]).toHaveTextContent('Apr 2026, 1 Apr 2026 – 30 Apr 2026, Complete month, 1 session, Unavailable: at least one session has an invalid recorded cost')
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
    expect(screen.getByText('16 Jul 2025 – 15 Jul 2026')).toBeInTheDocument()
    expect(screen.getAllByText('Jul*').length).toBeGreaterThan(0)
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Jul · MTD')).toBeInTheDocument()
    expect(screen.getByText('* Partial month · MTD: month to date.')).toBeInTheDocument()
    expect(screen.getByText('View monthly values')).toBeInTheDocument()
    expect(within(screen.getByText('Jul*').parentElement!).getByText('2025')).toBeInTheDocument()
    expect(within(screen.getByText('Jul · MTD').parentElement!).getByText('2026')).toBeInTheDocument()
    expect(screen.getByText('Jul*').parentElement).not.toHaveTextContent(/\d{1,2} [A-Z][a-z]{2} 202\d – \d{1,2} [A-Z][a-z]{2} 202\d/)
  })

  it('shows only partial-month guidance for a non-current partial first month', () => {
    // Arrange
    const partialTrend: SessionSpendingTrend = {
      startUtc: new Date(2024, 6, 9), endUtc: new Date(2024, 9, 9), selectedMonth: null, unit: 'month', isEmpty: false,
      buckets: [{
        startUtc: new Date(2024, 6, 9), endUtc: new Date(2024, 7, 1), totalSessionSpendCents: 250,
        sessionCount: 1, unit: 'month', month: { year: 2024, month: 6 }, isCurrentMonth: false, isPartialMonth: true,
      }],
    }

    // Act
    render(<SessionSpendingTrendSlab period={period} trend={partialTrend} isLoading={false} />)

    // Assert
    expect(screen.getByText('9 Jul – 8 Oct 2024')).toBeInTheDocument()
    expect(screen.getByText('* Partial month')).toBeInTheDocument()
    expect(screen.queryByText('MTD: month to date.')).not.toBeInTheDocument()
    expect(screen.getAllByText('Jul*').length).toBeGreaterThan(0)
    expect(screen.queryByText('Jul · MTD')).not.toBeInTheDocument()
    expect([...document.querySelectorAll('p')].some(({ textContent }) => textContent?.includes('Jul 2024 · Partial month'))).toBe(false)
    const plot = screen.getByRole('slider', { name: 'Monthly spending by month' })
    fireEvent.focus(plot)
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[0]).toHaveTextContent('Jul 2024 · 2,50 €')
    expect(plot.querySelector('[data-spending-tooltip="true"]')!.children[1]).toHaveTextContent('9–31 Jul · Partial month')
  })

  it('shows both years when the quiet chart range crosses a year boundary', () => {
    // Arrange
    const yearBoundaryTrend: SessionSpendingTrend = {
      ...trend,
      startUtc: new Date(2025, 11, 9),
      endUtc: new Date(2026, 0, 9),
      buckets: [{
        ...trend.buckets[0]!, startUtc: new Date(2025, 11, 9), endUtc: new Date(2026, 0, 1),
        month: { year: 2025, month: 11 }, isPartialMonth: true, isCurrentMonth: false,
      }],
    }

    // Act
    render(<SessionSpendingTrendSlab period={period} trend={yearBoundaryTrend} isLoading={false} />)

    // Assert
    expect(screen.getByText('9 Dec 2025 – 8 Jan 2026')).toBeInTheDocument()
  })
})
