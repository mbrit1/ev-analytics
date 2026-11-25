import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { calculateBillingProviderBreakdown } from '../model/billingProviderBreakdown'
import { calculateMonthlySessionSpend } from '../model/monthlySessionSpend'
import { comparePreviousPeriod } from '../model/previousPeriodComparison'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { ChargingSession } from '../../charging-sessions'
import {
  useOverallChargingPrice,
  type OverallChargingPriceQueryState,
} from '../hooks/useOverallChargingPrice'
import { AnalyticsPage } from './AnalyticsPage'
import { formatAnalyticsPeriodRange } from './analyticsPeriodLabels'

vi.mock('../hooks/useMonthlySessionSpend', () => ({
  useMonthlySessionSpend: vi.fn(),
}))
vi.mock('../hooks/useOverallChargingPrice', () => ({
  useOverallChargingPrice: vi.fn(),
}))
vi.mock('../hooks/useAnalyticsLayoutMode', () => ({
  useAnalyticsLayoutMode: vi.fn(),
}))

const monthlyResult = {
  totalSessionSpendCents: 0,
  averageSessionPriceCtPerKwh: null,
  billedEnergyKwh: null,
  sessionCount: 0,
  validBilledEnergySessionCount: 0,
  periodStartUtc: new Date(2026, 6, 1),
  periodEndUtc: new Date(2026, 7, 1),
  isCurrentMonth: true,
  isCompleteMonth: false,
  isEmpty: true,
}
const emptyProviderBreakdown = calculateBillingProviderBreakdown([], createAnalyticsPeriod(
  { kind: 'month', month: { year: 2026, month: 6 } },
  new Date(2026, 6, 15, 12),
))
const emptyComparison = {
  status: 'no-comparison-data' as const,
  spending: { status: 'unavailable' as const },
  energy: { status: 'unavailable' as const },
  priceDifferenceEurPerKwh: null,
}

const emptyMonthlyQuery = {
  result: monthlyResult,
  previousResult: monthlyResult,
  comparison: emptyComparison,
  providerBreakdown: emptyProviderBreakdown,
  isLoading: false,
  error: null,
}

const readyOverallPrice: OverallChargingPriceQueryState = {
  status: 'success',
  result: {
    status: 'ready',
    sessionCount: 2,
    billedEnergyKwh: 10,
    sessionSpendCents: 500,
    fixedCostCents: 100,
    includedSpendCents: 600,
    overallPriceCtPerKwh: 60,
  },
}

/**
 * Test suite for responsive Analytics page composition.
 *
 * Verifies one lifetime data-query path, vertical ordering on mobile and desktop,
 * focus recovery, technical error handling, and local-date rollover behavior.
 */
describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(useMonthlySessionSpend).mockReturnValue(emptyMonthlyQuery)
    vi.mocked(useOverallChargingPrice).mockReturnValue(readyOverallPrice)
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the summary before lifetime Overall Price on sidebar layouts', () => {
    // Arrange: Freeze time while the responsive mode is sidebar.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))

    // Act: Render the combined desktop Analytics page.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Both sections use ordinary document order without mobile tab semantics.
    const overallHeading = screen.getByRole('heading', { name: 'Overall price', level: 2 })
    const monthlyHeading = screen.getByRole('heading', { name: 'July 2026 summary, 1 Jul – 15 Jul 2026, Month to date, in progress', level: 2 })
    expect(overallHeading.compareDocumentPosition(monthlyHeading))
      .toBe(Node.DOCUMENT_POSITION_PRECEDING)
    expect(monthlyHeading).toHaveTextContent('Summary')
    expect(within(screen.getByRole('region', { name: 'Selected-period analytics' })).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['Session spend', 'Billed energy', 'Average session price'])
    expect(screen.queryByRole('tablist', { name: 'Analytics view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice)).toHaveBeenCalledWith('2026-07-15')
  })

  it('shows only the two exact month-to-date windows even when both are empty', () => {
    // Arrange
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))

    // Act
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert
    const chart = screen.getByRole('region', { name: 'Period comparison' })
    expect(within(chart).getByRole('region', { name: 'Previous period' })).toHaveTextContent('1 Jun – 15 Jun 2026')
    expect(within(chart).getByRole('region', { name: 'Selected period' })).toHaveTextContent('1 Jul – 15 Jul 2026')
    expect(within(chart).getAllByText('No sessions')).toHaveLength(2)
    expect(within(chart).queryByText(/Months context/)).not.toBeInTheDocument()
  })

  it('shows both sections on mobile and keeps lifetime independent of month selection', async () => {
    // Arrange
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    // Act
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    const summary = within(screen.getByRole('region', { name: 'Selected-period analytics' }))
    expect(summary.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['Average session price', 'Session spend', 'Billed energy'])
    expect(summary.getByRole('button', { name: 'Compare periods', expanded: false })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Period comparison' })).not.toBeInTheDocument()
    expect(summary.getByText('0 charging sessions')).toBeVisible()

    // Assert
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /June 2026 summary/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overall price' })).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it('switches presets and restores the previously selected calendar month', async () => {
    // Arrange: Start in calendar-month mode and navigate to the previous month.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Choose calendar month/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    await user.click(screen.getByRole('button', { name: 'Compare periods' }))

    // Act: Select every trailing preset, then return to calendar-month mode.
    for (const [name, preset] of [
      ['7 Days', '7-days'],
      ['30 Days', '30-days'],
      ['3 Months', '3-months'],
      ['Year', 'year'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name }))
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
      const period = createAnalyticsPeriod({ kind: 'preset', preset }, new Date(2026, 6, 15, 12))
      expect(screen.getByRole('region', { name: 'Previous period' }))
        .toHaveTextContent(formatAnalyticsPeriodRange(createPreviousAnalyticsPeriod(period)))
      expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument()
      expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
        .toEqual({ kind: 'preset', preset })
    }
    await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name: 'Calendar Month' }))

    // Assert: The prior month remains selected after changing modes.
    expect(screen.getByRole('heading', { name: /June 2026 summary/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('2 May – 31 May 2026')
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it('shows exact desktop comparison dates for short presets and keeps provider and lifetime totals visible', async () => {
    // Arrange: June falls outside 7 Days but inside 30 Days; July remains in both periods.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useMonthlySessionSpend).mockImplementation((period) => {
      const sessions: ChargingSession[] = [
        {
          id: 'june-provider-session', user_id: 'analytics-owner', session_mode: 'ad_hoc', provider_id: null,
          tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 100 },
          session_timestamp: new Date(2026, 5, 20, 12), provider_name_snapshot: 'Shared Provider', charging_type: 'AC',
          kwh_billed: 5, total_cost: 500, applied_session_fee: 0, created_at: new Date(2026, 5, 20, 12), updated_at: new Date(2026, 5, 20, 12),
        },
        {
          id: 'july-provider-session', user_id: 'analytics-owner', session_mode: 'ad_hoc', provider_id: null,
          tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 100 },
          session_timestamp: new Date(2026, 6, 10, 12), provider_name_snapshot: 'Shared Provider', charging_type: 'AC',
          kwh_billed: 10, total_cost: 1200, applied_session_fee: 0, created_at: new Date(2026, 6, 10, 12), updated_at: new Date(2026, 6, 10, 12),
        },
      ]
      return {
        result: calculateMonthlySessionSpend(sessions, period),
        providerBreakdown: calculateBillingProviderBreakdown(sessions, period),
        previousResult: monthlyResult,
        comparison: emptyComparison,
        isLoading: false,
        error: null,
      }
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: July is initially selected, and provider totals follow its period.
    const initialProviderHeading = screen.getByRole('heading', { name: 'Billing providers' })
    const initialProviderTotals = screen.getByRole('list', { name: 'Provider totals' })
    const lifetime = screen.getByRole('region', { name: 'Lifetime Overall Price' })
    const lifetimeSnapshot = lifetime.textContent
    expect(within(initialProviderTotals).getAllByText('12,00 €').length).toBeGreaterThan(0)
    expect(initialProviderHeading.compareDocumentPosition(lifetime)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(lifetime).toHaveTextContent('0,60')

    // Act / Assert: Both short presets show the chart and keep provider totals before lifetime.
    for (const [label, expectedSpend, previousRange] of [
      ['7 Days', '12,00 €', '2 Jul – 8 Jul 2026'],
      ['30 Days', '17,00 €', '17 May – 15 Jun 2026'],
    ] as const) {
      const ranges = screen.getByRole('button', { name: /^Other ranges/ })
      await user.click(ranges)
      const option = within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: label })
      if (label === '30 Days') await user.tab()
      expect(option).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(ranges).toHaveFocus()
      expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
      expect(screen.getByText(`Previous period · ${previousRange}`)).toBeInTheDocument()
      const providerHeading = screen.getByRole('heading', { name: 'Billing providers' })
      const providerTotals = screen.getByRole('list', { name: 'Provider totals' })
      expect(within(providerTotals).getAllByText(expectedSpend).length).toBeGreaterThan(0)
      expect(providerHeading.compareDocumentPosition(lifetime)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(lifetime.textContent).toBe(lifetimeSnapshot)
    }
  })

  it('preserves the chosen chart metric across disclosure toggles and both short presets', async () => {
    // Arrange
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    const summary = within(screen.getByRole('region', { name: 'Selected-period analytics' }))
    const trigger = summary.getByRole('button', { name: 'Compare periods', expanded: false })
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)
    expect(panel).toHaveAttribute('hidden')
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(summary.getByRole('region', { name: 'Period comparison' })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Price/kWh' })).toBeChecked()

    // Act: Select Energy, then visit both short presets and return to Calendar Month.
    await user.click(screen.getByRole('radio', { name: 'Energy' }))
    await user.click(trigger)
    expect(trigger).toHaveFocus()
    expect(panel).toHaveAttribute('hidden')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('radio', { name: 'Energy' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Selected period' })).toBeInTheDocument()
    for (const label of ['7 Days', '30 Days', '3 Months', 'Year']) {
      await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name: label }))
      expect(screen.getByRole('radio', { name: 'Energy' })).toBeChecked()
      expect(screen.getByRole('heading', { name: new RegExp(`${label} summary`) })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name: 'Calendar Month' }))
      expect(screen.getByRole('radio', { name: 'Energy' })).toBeChecked()
      expect(screen.getByRole('region', { name: 'Selected period' })).toBeInTheDocument()
    }

    // Assert: Returning to Calendar Month retains Energy without changing the independent period controls.
    expect(screen.getByRole('radio', { name: 'Energy' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Selected period' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()

    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Spending' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Compare periods' })).not.toBeInTheDocument()
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Energy' })).toBeChecked()
  })

  it('keeps the selected period and summary when changing chart mode, and retains mode across chart periods', async () => {
    // Arrange: Use real June and July sessions so the summary and chart share period-scoped inputs.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    const sessions: ChargingSession[] = [
      {
        id: 'june-session', user_id: 'analytics-owner', session_mode: 'ad_hoc', provider_id: null,
        tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc',
        ad_hoc_pricing: { pricePerKwh: 100 }, session_timestamp: new Date(2026, 5, 10, 12),
        provider_name_snapshot: 'Test provider', charging_type: 'AC', kwh_billed: 5,
        total_cost: 500, applied_session_fee: 0, created_at: new Date(2026, 5, 10, 12),
        updated_at: new Date(2026, 5, 10, 12),
      },
      {
        id: 'july-session', user_id: 'analytics-owner', session_mode: 'ad_hoc', provider_id: null,
        tariff_plan_id: null, plan_selection_id: null, pricing_context: 'ad_hoc',
        ad_hoc_pricing: { pricePerKwh: 100 }, session_timestamp: new Date(2026, 6, 10, 12),
        provider_name_snapshot: 'Test provider', charging_type: 'AC', kwh_billed: 10,
        total_cost: 1200, applied_session_fee: 0, created_at: new Date(2026, 6, 10, 12),
        updated_at: new Date(2026, 6, 10, 12),
      },
    ]
    vi.mocked(useMonthlySessionSpend).mockImplementation((period, previousPeriod) => {
      const result = calculateMonthlySessionSpend(sessions, period)
      const previousResult = calculateMonthlySessionSpend(sessions, {
        ...previousPeriod, isCurrentMonth: false, isCompleteMonth: false,
      })
      return {
        result,
        providerBreakdown: calculateBillingProviderBreakdown(sessions, period),
        previousResult,
        comparison: comparePreviousPeriod(result, previousResult, period, previousPeriod),
        isLoading: false,
        error: null,
      }
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Capture July's selection, summary values, bounds and selected Spending value before the mode switch.
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
    const julyHeading = screen.getByRole('heading', { name: /July 2026 summary/ })
    const julySummaryName = julyHeading.getAttribute('aria-label')
    const selectedSummary = screen.getByRole('region', { name: 'Selected-period analytics' })
    expect(within(selectedSummary).getByText('10')).toBeInTheDocument()
    expect(within(selectedSummary).getByText('1,20')).toBeInTheDocument()
    const julySpendingChart = screen.getByRole('region', { name: 'Selected period' })
    expect(julySpendingChart).toHaveTextContent('12,00 €')
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('5,00 €')
    expect(within(selectedSummary).getByText('Previous: 5,00 €')).toBeInTheDocument()
    const julyPeriod = vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]
    expect(julyPeriod).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 6 } },
      startUtc: new Date(2026, 6, 1), endUtc: new Date(2026, 6, 16),
    })

    // Act: Change chart mode while July remains selected.
    await user.click(screen.getByRole('radio', { name: 'Energy' }))

    // Assert: The chart presentation changes while the month, summary metrics, and lifetime KPI stay put.
    expect(screen.getByRole('button', { name: /^Choose calendar month/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /July 2026 summary/ })).toHaveAttribute('aria-label', julySummaryName)
    expect(within(selectedSummary).getByText('10')).toBeInTheDocument()
    expect(within(selectedSummary).getByText('1,20')).toBeInTheDocument()
    const julyEnergyChart = screen.getByRole('region', { name: 'Selected period' })
    expect(julyEnergyChart).toHaveTextContent('10 kWh')
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('5 kWh')
    expect(within(selectedSummary).getByText('Previous: 5 kWh')).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 6 } },
      startUtc: julyPeriod?.startUtc, endUtc: julyPeriod?.endUtc,
    })
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)

    // Act: Select Price/kWh while the same current calendar month stays selected.
    await user.click(screen.getByRole('radio', { name: 'Price/kWh' }))

    // Assert: The third metric uses July’s weighted value without changing summary or lifetime scope.
    expect(screen.getByRole('radio', { name: 'Price/kWh' })).toBeChecked()
    const julyPriceChart = screen.getByRole('region', { name: 'Selected period' })
    expect(julyPriceChart).toHaveTextContent('1,20 €/kWh')
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('1,00 €/kWh')
    expect(within(selectedSummary).getByText('Previous: 1,00 €/kWh')).toBeInTheDocument()
    expect(julyPriceChart).toHaveTextContent('1 Jul – 15 Jul 2026')
    expect(screen.getByRole('heading', { name: /July 2026 summary/ })).toHaveAttribute('aria-label', julySummaryName)
    expect(within(selectedSummary).getByText('10')).toBeInTheDocument()
    expect(within(selectedSummary).getByText('1,20')).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 6 } },
      startUtc: new Date(2026, 6, 1), endUtc: new Date(2026, 6, 16),
    })

    await user.click(screen.getByRole('button', { name: /^Other ranges/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: '3 Months' }))

    // Assert: The selected period changes its summary data, while Price/kWh remains the chosen chart mode.
    expect(screen.getByRole('heading', { name: /3 Months summary/ })).toBeInTheDocument()
    expect(within(selectedSummary).getByText('15')).toBeInTheDocument()
    expect(within(selectedSummary).getByText('1,13')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Price/kWh' })).toBeChecked()
    const threeMonthChart = screen.getByRole('region', { name: 'Selected period' })
    expect(threeMonthChart).toBeInTheDocument()
    expect(threeMonthChart).toHaveTextContent('1,13 €/kWh')
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'preset', preset: '3-months' })
    expect(julyPeriod).toMatchObject({ selection: { kind: 'month', month: { year: 2026, month: 6 } } })
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      startUtc: new Date(2026, 3, 16), endUtc: new Date(2026, 6, 16),
    })
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)

    // Act: Check the Energy marks remain available across the same 3 Months range.
    await user.click(screen.getByRole('radio', { name: 'Energy' }))

    // Assert: The chart shows the aggregate energy for both selected sessions.
    const threeMonthEnergyChart = screen.getByRole('region', { name: 'Selected period' })
    expect(threeMonthEnergyChart).toHaveTextContent('15 kWh')

    // Act: Restore Price/kWh before continuing to Year.
    await user.click(screen.getByRole('radio', { name: 'Price/kWh' }))

    // Act: Switch to Year and verify the rolling range while retaining the selected metric.
    await user.click(screen.getByRole('button', { name: /^Other ranges \(3 Months\)/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: 'Year' }))

    // Assert: The chart follows Year bounds, the summary follows the selected range, and lifetime remains fixed.
    expect(screen.getByRole('heading', { name: /Year summary, 16 Jul 2025 – 15 Jul 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('16 Jul 2025 – 15 Jul 2026')
    expect(screen.getByRole('radio', { name: 'Price/kWh' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Selected period' })).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      selection: { kind: 'preset', preset: 'year' },
      startUtc: new Date(2025, 6, 16), endUtc: new Date(2026, 6, 16),
    })
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)

    // Act: Return to Calendar Month and select historical June.
    await user.click(screen.getByRole('button', { name: /^Other ranges \(Year\)/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: 'Calendar Month' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Assert: The chart follows June’s historical summary bounds.
    expect(screen.getByRole('heading', { name: /June 2026 summary, 1 Jun – 30 Jun 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('1 Jun – 30 Jun 2026')
    expect(screen.getByRole('radio', { name: 'Price/kWh' })).toBeChecked()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 5 } },
      startUtc: new Date(2026, 5, 1), endUtc: new Date(2026, 6, 1),
    })
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it('refreshes a selected preset at local midnight without changing its mode', async () => {
    // Arrange: Open Analytics immediately before the selected period's end advances.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 59))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    vi.mocked(useMonthlySessionSpend).mockImplementation((period) => {
      return {
        result: monthlyResult,
        providerBreakdown: calculateBillingProviderBreakdown([], period),
        isLoading: false,
        error: null,
        previousResult: monthlyResult,
        comparison: emptyComparison,
      }
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name: '7 Days' }))

    await user.click(screen.getByRole('button', { name: 'Compare periods' }))

    // Assert: The short preset shows its selected summary alongside its comparison chart.
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected-period analytics' })).toBeInTheDocument()

    // Act: Cross both local day and month boundaries while Analytics stays mounted.
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // Assert: The period refreshes in place and the preset remains selected.
    expect(screen.getByText('7 Days')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('26 Jul – 1 Aug 2026 · In progress')
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'preset', preset: '7-days' })
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      startUtc: new Date(2026, 6, 26),
      endUtc: new Date(2026, 7, 2),
    })
    expect(screen.getByRole('heading', { name: /7 Days summary/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()

    // Act: Return to calendar mode after the day and month rollover.
    await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name: 'Calendar Month' }))

    // Assert: The historical month selected before the preset remains selected.
    expect(screen.getByRole('heading', { name: /June 2026 summary/ })).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'month', month: { year: 2026, month: 5 } })
  })

  it('uses rolling desktop ranges without stepping and restores the remembered calendar month', async () => {
    // Arrange: Render the desktop route and retain June before choosing a preset.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    vi.mocked(useMonthlySessionSpend).mockImplementation((period) => ({
      result: monthlyResult,
      providerBreakdown: calculateBillingProviderBreakdown([], period),
      isLoading: false,
      error: null,
      previousResult: monthlyResult,
      comparison: emptyComparison,
    }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Act: Choose each relative range through the same options control.
    for (const [label, preset, range] of [
      ['7 Days', '7-days', '9 Jul – 15 Jul 2026'],
      ['30 Days', '30-days', '16 Jun – 15 Jul 2026'],
      ['3 Months', '3-months', '16 Apr – 15 Jul 2026'],
      ['Year', 'year', '16 Jul 2025 – 15 Jul 2026'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: /^Other ranges/ }))
      await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: label }))

      // Assert: The title and exact range follow the rolling period, with no month controls.
      expect(screen.getByRole('heading', { name: new RegExp(`${label} summary`) })).toBeInTheDocument()
      expect(screen.getAllByText(new RegExp(range.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent(`${range} · In progress`)
      expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
        .toEqual({ kind: 'preset', preset })
      expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
    }

    // Act: Return to the remembered June through the period-options control.
    await user.click(screen.getByRole('button', { name: 'Other ranges (Year)' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: 'Calendar Month' }))

    // Assert: Month arrows return only in calendar mode and navigate the existing period.
    expect(screen.getByRole('heading', { name: /June 2026 summary/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: /July 2026 summary/ })).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'month', month: { year: 2026, month: 6 } })
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it.each([
    ['7 Days', '7-days'],
    ['30 Days', '30-days'],
  ] as const)('keeps summary and lifetime actions with %s and shows the chart', async (label, preset) => {
    // Arrange
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useMonthlySessionSpend).mockImplementation((period) => ({
      result: monthlyResult,
      providerBreakdown: calculateBillingProviderBreakdown([], period),
      isLoading: false,
      error: null,
      previousResult: monthlyResult,
      comparison: emptyComparison,
    }))
    const onAddSession = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={onAddSession} />)

    // Act
    await user.click(screen.getByRole('button', { name: /^Other ranges/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: label }))

    // Assert
    expect(screen.getByRole('heading', { name: new RegExp(`${label} summary`) })).toBeInTheDocument()
    expect(screen.getByText(/No charging sessions recorded for this period yet/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overall price' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    await user.click(screen.getByRole('button', { name: 'Add Session' }))
    expect(onAddSession).toHaveBeenCalledOnce()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'preset', preset })
  })

  it('passes the bottom-dock layout through to the Overall Price information sheet', async () => {
    // Arrange: Render the mobile Analytics overview with its responsive layout mode.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Act: Open the Overall Price calculation explanation.
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Assert: Page composition retains the bottom-sheet interaction contract.
    expect(screen.getByRole('dialog', { name: 'How Overall Price is calculated' }))
      .toHaveAttribute('aria-modal', 'true')
  })

  it('restores disclosure-trigger focus when an open sheet closes at the breakpoint', async () => {
    // Arrange: Open the mobile sheet before Analytics changes composition.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))
    expect(screen.getByRole('dialog', { name: 'How Overall Price is calculated' }))
      .toBeInTheDocument()

    // Act: Cross to the sidebar disclosure mode while retaining the Overall Price slab.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Modal cleanup completes before focus reaches the live trigger.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'How Overall Price is calculated' }))
        .toHaveFocus()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores focus to the Summary information action when the mobile sheet closes at the breakpoint', async () => {
    // Arrange
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Compare periods' }))
    await user.click(screen.getByRole('button', { name: 'How these metrics are calculated' }))
    expect(screen.getByRole('button', { name: 'Close Charging Summary information' })).toHaveFocus()

    // Act
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert
    const summary = within(screen.getByRole('region', { name: 'Selected-period analytics' }))
    await waitFor(() => expect(summary.getByRole('button', { name: 'How Charging Summary is calculated' })).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('preserves month-control focus across layout changes', async () => {
    // Arrange
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    screen.getByRole('button', { name: 'Previous month' }).focus()
    // Act
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    // Assert
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous month' })).toHaveFocus())
  })

  it('renders a busy Overall Price slab without a stale value while the query loads', () => {
    // Arrange: Hold the lifetime source query in its explicit loading state.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useOverallChargingPrice).mockReturnValue({ status: 'loading' })

    // Act: Render sidebar Analytics while monthly data remains available.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: The monthly section remains usable and the KPI reserves busy geometry.
    const loadingCopy = screen.getByText('Loading Overall Price')
    expect(loadingCopy).toBeInTheDocument()
    expect(loadingCopy.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('60,0 ct/kWh')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /July 2026 summary/ })).toBeInTheDocument()
  })

  it('renders a page-level technical error and recovers into the slab on the next success', () => {
    // Arrange: Simulate an unexpected local-query failure.
    let overallState: OverallChargingPriceQueryState = {
      status: 'error',
      error: new Error('IndexedDB unavailable'),
    }
    vi.mocked(useOverallChargingPrice).mockImplementation(() => overallState)
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to calculate Overall Price right now. Please try again.',
    )

    // Act: Recover the query without changing the selected month.
    overallState = readyOverallPrice
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: A technical failure is never passed through as a calculation result.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overall price', level: 2 })).toBeInTheDocument()
  })

  it('updates both monthly and lifetime local-date inputs after the page remains open overnight', async () => {
    // Arrange: Open Analytics just before the final midnight in July.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 59))
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Act: Let the page cross into August without remounting.
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // Assert: The month selector and explicit lifetime local date update together.
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 6 } },
      endUtc: new Date(2026, 7, 1),
      isCompleteMonth: true,
    })
    expect(vi.mocked(useOverallChargingPrice).mock.calls.at(-1)).toEqual(['2026-08-01'])
  })

  it('queries the selected period and its immediately preceding comparison period', () => {
    // Arrange: Select the current month with a fixed day of month.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))

    // Act: Render the month-to-date Analytics page.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: The query receives both exact local-calendar windows and comparison dates are integrated into the summary.
    const [currentPeriod, previousPeriod] = vi.mocked(useMonthlySessionSpend).mock.calls.at(-1) ?? []
    expect(currentPeriod).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 6 } },
      startUtc: new Date(2026, 6, 1),
      endUtc: new Date(2026, 6, 16),
    })
    expect(previousPeriod).toMatchObject({
      startUtc: new Date(2026, 5, 1),
      endUtc: new Date(2026, 5, 16),
      isDayCountEqual: true,
    })
    const summary = screen.getByRole('region', { name: 'Selected-period analytics' })
    expect(within(summary).getByText('Previous period · 1 Jun – 15 Jun 2026')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Previous period comparison' })).not.toBeInTheDocument()
    const chart = screen.getByRole('heading', { name: 'Period comparison' })
    const providers = screen.getByRole('heading', { name: 'Billing providers' })
    expect(summary.compareDocumentPosition(chart)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(chart.compareDocumentPosition(providers)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('updates comparison ranges and displayed values when the selected calendar month changes', async () => {
    // Arrange: Return distinct aggregates for July and June so stale data is detectable.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useMonthlySessionSpend).mockImplementation((selectedPeriod) => {
      const selectedJuly = selectedPeriod.selection.kind === 'month' && selectedPeriod.selection.month.month === 6
      const current = { ...monthlyResult, isEmpty: false, sessionCount: 1, totalSessionSpendCents: selectedJuly ? 12_000 : 20_000, billedEnergyKwh: 100, validBilledEnergySessionCount: 1 }
      const prior = { ...monthlyResult, isEmpty: false, sessionCount: 1, totalSessionSpendCents: selectedJuly ? 9_000 : 11_000, billedEnergyKwh: 90, validBilledEnergySessionCount: 1 }
      return {
        result: current,
        previousResult: prior,
        providerBreakdown: emptyProviderBreakdown,
        comparison: { status: 'compared', spending: { status: 'percentage', percentage: 25 }, energy: { status: 'percentage', percentage: 10 }, priceDifferenceEurPerKwh: 0.03 },
        isLoading: false,
        error: null,
      }
    })
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert initial July comparison before selecting June.
    expect(screen.getAllByText('July 2026').length).toBeGreaterThan(0)
    expect(screen.queryByText('Previous period · 1 Jun – 15 Jun 2026')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Session spend' })).toHaveTextContent(/120,00 €.*\+30,00 €/)

    await user.click(screen.getByRole('button', { name: 'Compare periods' }))
    await user.click(screen.getByRole('radio', { name: 'Spending' }))
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('120,00 €')
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent(/90,00 €.*1 Jun – 15 Jun 2026/)

    // Act: Navigate to the previous calendar month.
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Assert: Both labels and values follow the newly selected month.
    expect(screen.getByRole('button', { name: 'Compare periods', expanded: true })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent(/200,00 €.*1 Jun – 30 Jun 2026/)
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent(/110,00 €.*2 May – 31 May 2026/)
    expect(screen.getAllByText('June 2026').length).toBeGreaterThan(0)
    expect(screen.getByText('1 Jun – 30 Jun 2026 · Completed month')).toBeInTheDocument()
    expect(screen.queryByText('Previous period · 2 May – 31 May 2026')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Session spend' })).toHaveTextContent(/200,00 €.*\+90,00 €/)
    expect(within(screen.getByRole('region', { name: 'Session spend' })).queryByText('120,00 €')).not.toBeInTheDocument()
  })

  it('keeps lifetime available during a monthly query failure and recovers', () => {
    // Arrange
    vi.mocked(useMonthlySessionSpend).mockReturnValue({
      ...emptyMonthlyQuery,
      error: new Error('read failed'),
    })
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    // Act / Assert
    expect(screen.getByText('Unable to load the summary. Please try again.')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    vi.mocked(useMonthlySessionSpend).mockReturnValue(emptyMonthlyQuery)
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('0 charging sessions')).toBeInTheDocument()
  })

})
