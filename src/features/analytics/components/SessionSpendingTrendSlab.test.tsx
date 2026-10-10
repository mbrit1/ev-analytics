import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import type { SessionSpendingTrend } from '../model/sessionSpendingTrend'
import { SessionSpendingTrendSlab } from './SessionSpendingTrendSlab'

const bucketDates = [0, 1, 2, 3, 4, 5].map((month) => new Date(2026, month, 1))
const trend: SessionSpendingTrend = {
  startUtc: bucketDates[0]!,
  endUtc: bucketDates[5]!,
  selectedMonth: { year: 2026, month: 4 },
  unit: 'month',
  isEmpty: false,
  buckets: [
    { startUtc: bucketDates[0]!, endUtc: bucketDates[1]!, totalSessionSpendCents: 0, sessionCount: 1, unit: 'month', month: { year: 2026, month: 0 }, isCurrentMonth: false, isPartialMonth: false },
    { startUtc: bucketDates[1]!, endUtc: bucketDates[2]!, totalSessionSpendCents: 500, sessionCount: 1, unit: 'month', month: { year: 2026, month: 1 }, isCurrentMonth: false, isPartialMonth: false },
    { startUtc: bucketDates[2]!, endUtc: bucketDates[3]!, totalSessionSpendCents: null, sessionCount: 1, unit: 'month', month: { year: 2026, month: 2 }, isCurrentMonth: false, isPartialMonth: false },
    { startUtc: bucketDates[3]!, endUtc: bucketDates[4]!, totalSessionSpendCents: 0, sessionCount: 1, unit: 'month', month: { year: 2026, month: 3 }, isCurrentMonth: false, isPartialMonth: false },
    { startUtc: bucketDates[4]!, endUtc: bucketDates[5]!, totalSessionSpendCents: 600, sessionCount: 1, unit: 'month', month: { year: 2026, month: 4 }, isCurrentMonth: false, isPartialMonth: false },
  ],
}

/** Verifies the trend plot's pointer, keyboard, tooltip, gaps, and text alternative. */
describe('SessionSpendingTrendSlab', () => {
  const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))

  it('exposes one keyboard slider and selects neighboring buckets with arrows, Home, and End', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Session spending by bucket' })

    // Act
    await user.tab()
    expect(plot).toHaveFocus()
    await user.keyboard('{ArrowRight}')

    // Assert
    expect(plot).toHaveAttribute('aria-valuenow', '1')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('Feb 2026'))
    expect(plot.querySelector('div.absolute')).toHaveTextContent('Feb 2026 · 5,00 €')
    await user.keyboard('{End}')
    expect(plot).toHaveAttribute('aria-valuenow', '4')
    expect(plot.querySelector('div.absolute')).toHaveTextContent('May 2026 · 6,00 €')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(plot).toHaveAttribute('aria-valuenow', '4')
    await user.keyboard('{Home}')
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(plot.querySelector('div.absolute')).toHaveTextContent('Jan 2026 · 0,00 €')
    await user.keyboard('{ArrowLeft}')
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /spending bucket/i })).not.toBeInTheDocument()
  })

  it('selects the nearest bucket by pointer and creates separate line-area segments around unavailable costs', () => {
    // Arrange
    render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Session spending by bucket' })
    Object.defineProperty(plot, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 500, bottom: 160, width: 500, height: 160, x: 0, y: 0, toJSON: () => {} }),
    })

    // Act: Select the unavailable and zero-spend buckets by pointer.
    fireEvent.pointerDown(plot, { clientX: 250, clientY: 80, pointerId: 1 })

    // Assert: The null bucket stays unavailable and opens no invented point.
    expect(plot).toHaveAttribute('aria-valuenow', '2')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('Unavailable'))
    expect(plot.querySelector('div.absolute')).toHaveTextContent('Mar 2026 · Unavailable')
    expect(plot.querySelectorAll('circle')).toHaveLength(0)
    expect(plot).toHaveFocus()
    fireEvent.pointerDown(plot, { clientX: 490, clientY: 80, pointerId: 1, button: 2 })
    expect(plot).toHaveAttribute('aria-valuenow', '2')
    fireEvent.pointerDown(plot, { clientX: 0, clientY: 80, pointerId: 1 })
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(plot.querySelector('div.absolute')).toHaveTextContent('Jan 2026 · 0,00 €')
    const zeroMarker = plot.querySelector('[data-selected-bucket-point="true"]')!
    const baseline = plot.querySelector('[data-scale-ratio="0"]')!
    expect(zeroMarker.getAttribute('cy')).toBe(baseline.getAttribute('y1'))

    // Act: Select the far-right point using the plot's large hit area.
    fireEvent.pointerDown(plot, { clientX: 490, clientY: 80, pointerId: 1 })

    // Assert: The last bucket is selected and no area path spans the null bucket.
    expect(plot).toHaveAttribute('aria-valuenow', '4')
    expect(plot.querySelector('div.absolute')).toHaveTextContent('May 2026 · 6,00 €')
    const svg = plot.querySelector('svg')!
    const segments = [...svg.querySelectorAll('[data-trend-segment="true"]')]
    expect(segments).toHaveLength(2)
    for (const segment of segments) {
      const [area, line] = segment.querySelectorAll('path')
      expect(area).toHaveAttribute('stroke', 'none')
      expect(area).toHaveAttribute('d', expect.stringMatching(/Z$/))
      expect(line).toHaveAttribute('fill', 'none')
      expect(line).toHaveAttribute('stroke', 'var(--color-accent)')
      expect(line).toHaveAttribute('vector-effect', 'non-scaling-stroke')
      expect(line?.getAttribute('d')).not.toMatch(/Z$/)
    }
    const selectedMarker = svg.querySelector('[data-selected-bucket-point="true"]')!
    const selectedSegmentLine = segments[1]!.querySelectorAll('path')[1]!
    const selectedLinePoint = selectedSegmentLine.getAttribute('d')!.trim().split(' ').slice(-2)
    expect(selectedMarker).toHaveAttribute('data-bucket-index', '4')
    expect(selectedMarker.getAttribute('cx')).toBe(selectedLinePoint[0])
    expect(selectedMarker.getAttribute('cy')).toBe(selectedLinePoint[1])
  })

  it('shows one partial-range tooltip and retains expandable textual values', async () => {
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
    await user.click(screen.getByText('View all bucket values'))

    // Assert
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', expect.stringContaining('11 Dec 2023 – 31 Dec 2023, partial month, 2 sessions, 12,34 €'))
    expect(within(screen.getByRole('table')).getByRole('row', { name: /11 Dec 2023 – 31 Dec 2023 · Partial month 2 12,34 €/ })).toBeInTheDocument()
  })

  it('distinguishes loading, failure, empty period, free sessions, and unavailable buckets', () => {
    // Arrange / Act: Render each state independently.
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading spending trend')
    rerender(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} error={new Error('offline')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load spending trend')
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [], isEmpty: true }} isLoading={false} />)
    expect(screen.getByText('No charging sessions recorded for this period.')).toBeInTheDocument()
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [trend.buckets[0]!], isEmpty: false }} isLoading={false} />)

    // Assert
    expect(screen.getByText('Recorded sessions in this period were free (0,00 €).')).toBeInTheDocument()
    rerender(<SessionSpendingTrendSlab period={period} trend={{ ...trend, buckets: [trend.buckets[2]!], isEmpty: false }} isLoading={false} />)
    expect(screen.getByText(/Unavailable: at least one session has an invalid recorded cost/)).toBeInTheDocument()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', expect.stringContaining('Mar 2026, 1 session, Unavailable'))
  })

  it('resets the selected bucket when the period changes', async () => {
    // Arrange
    const user = userEvent.setup()
    const { rerender } = render(<SessionSpendingTrendSlab period={period} trend={trend} isLoading={false} />)
    const plot = screen.getByRole('slider', { name: 'Session spending by bucket' })
    await user.click(plot)
    await user.keyboard('{ArrowRight}')
    expect(plot).toHaveAttribute('aria-valuenow', '1')

    // Act
    const nextPeriod = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 4 } }, new Date(2026, 6, 1))
    rerender(<SessionSpendingTrendSlab period={nextPeriod} trend={trend} isLoading={false} />)

    // Assert
    expect(plot).toHaveAttribute('aria-valuenow', '0')
    expect(plot).toHaveAttribute('aria-valuetext', expect.stringContaining('Jan 2026, 1 session, 0,00 €'))
  })
})
