import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAnalyticsPeriod,
  createMonthPeriod,
  getCalendarMonth,
  shiftCalendarMonth,
} from './analyticsPeriods'

/**
 * Test suite for analytics calendar-month periods.
 *
 * Verifies local-month navigation, completion metadata, and UTC-safe boundary
 * instants around standard-time and daylight-saving transitions.
 */
describe('analyticsPeriods', () => {
  const originalTimeZone = process.env.TZ

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
    vi.resetModules()
  })

  it('navigates across year boundaries', () => {
    // Arrange: Start at January 2026.
    const january = { year: 2026, month: 0 }

    // Act: Move backward and then forward twice.
    const december = shiftCalendarMonth(january, -1)
    const february = shiftCalendarMonth(january, 1)

    // Assert: Calendar years roll over correctly.
    expect(december).toEqual({ year: 2025, month: 11 })
    expect(february).toEqual({ year: 2026, month: 1 })
  })

  it('identifies current and completed months', () => {
    // Arrange: Fix the reference instant in July 2026.
    const now = new Date(2026, 6, 15, 12)

    // Act: Create current and prior periods.
    const current = createMonthPeriod({ year: 2026, month: 6 }, now)
    const prior = createMonthPeriod({ year: 2026, month: 5 }, now)

    // Assert: Only the prior month is complete.
    expect(current).toMatchObject({ isCurrentMonth: true, isCompleteMonth: false })
    expect(prior).toMatchObject({ isCurrentMonth: false, isCompleteMonth: true })
    expect(getCalendarMonth(now)).toEqual({ year: 2026, month: 6 })
  })

  it('creates Berlin local boundaries as absolute UTC instants across DST', async () => {
    // Arrange: Load the utility while the runtime uses Europe/Berlin.
    process.env.TZ = 'Europe/Berlin'
    vi.resetModules()
    const { createMonthPeriod: createBerlinPeriod } = await import('./analyticsPeriods')

    // Act: Build March, which crosses into daylight-saving time.
    const period = createBerlinPeriod(
      { year: 2026, month: 2 },
      new Date('2026-07-01T10:00:00.000Z'),
    )

    // Assert: Local midnight offsets differ across the exclusive boundaries.
    expect(period.startUtc.toISOString()).toBe('2026-02-28T23:00:00.000Z')
    expect(period.endUtc.toISOString()).toBe('2026-03-31T22:00:00.000Z')
  })
  it.each(['2026-03-29', '2026-10-25'])('ends month to date at local midnight after DST day %s', (day) => {
    // Arrange
    process.env.TZ = 'Europe/Berlin'
    const now = new Date(`${day}T12:00:00`)
    // Act
    const period = createMonthPeriod(getCalendarMonth(now), now)
    // Assert
    expect(period.endUtc).toEqual(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    expect(period.endUtc.getHours()).toBe(0)
  })

  it.each([
    ['7-days', 6],
    ['30-days', 29],
  ] as const)('creates the %s period from local calendar days', (preset, daysBeforeToday) => {
    // Arrange: Use a day immediately after Berlin enters daylight-saving time.
    process.env.TZ = 'Europe/Berlin'
    const now = new Date(2026, 2, 30, 16, 45)

    // Act: Build the selected trailing period.
    const period = createAnalyticsPeriod({ kind: 'preset', preset }, now)

    // Assert: Boundaries follow local dates and tomorrow starts exclusively.
    expect(period.startUtc).toEqual(new Date(2026, 2, 30 - daysBeforeToday))
    expect(period.endUtc).toEqual(new Date(2026, 2, 31))
    expect(period.isInProgress).toBe(true)
  })

  it('subtracts calendar months with month-end clamping for trailing periods', () => {
    // Arrange: Use end dates after February and at a 31st-day boundary.
    const leapYearNow = new Date(2024, 1, 28, 12)
    const monthEndNow = new Date(2026, 4, 30, 12)

    // Act: Build trailing year and three-month periods.
    const leapPeriod = createAnalyticsPeriod({ kind: 'preset', preset: 'year' }, leapYearNow)
    const monthEndPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, monthEndNow)
    const leapThreeMonthPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, new Date(2024, 4, 30, 12))

    // Assert: Subtraction clamps leap day and May 31 to February's last day.
    expect(leapPeriod.endUtc).toEqual(new Date(2024, 1, 29))
    expect(leapPeriod.startUtc).toEqual(new Date(2023, 1, 28))
    expect(monthEndPeriod.endUtc).toEqual(new Date(2026, 4, 31))
    expect(monthEndPeriod.startUtc).toEqual(new Date(2026, 1, 28))
    expect(leapThreeMonthPeriod.startUtc).toEqual(new Date(2024, 1, 29))
  })

  it('uses the exact trailing calendar boundaries for every preset', () => {
    // Arrange: Fix a mid-month date with unambiguous calendar subtraction.
    const now = new Date(2026, 10, 15, 14, 30)

    // Act: Build each available preset from the same exclusive end.
    const sevenDays = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now)
    const thirtyDays = createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, now)
    const threeMonths = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, now)
    const year = createAnalyticsPeriod({ kind: 'preset', preset: 'year' }, now)

    // Assert: Each range has the required exact inclusive start and exclusive end.
    expect(sevenDays.startUtc).toEqual(new Date(2026, 10, 9))
    expect(thirtyDays.startUtc).toEqual(new Date(2026, 9, 17))
    expect(threeMonths.startUtc).toEqual(new Date(2026, 7, 16))
    expect(year.startUtc).toEqual(new Date(2025, 10, 16))
    for (const period of [sevenDays, thirtyDays, threeMonths, year]) {
      expect(period.endUtc).toEqual(new Date(2026, 10, 16))
    }
  })

  it('keeps calendar-month mode distinct and honors historical month selection', () => {
    // Arrange: Select a completed month while the current month is later.
    const now = new Date(2026, 6, 15, 12)
    const selection = { kind: 'month' as const, month: { year: 2026, month: 4 } }

    // Act: Build the selected month period.
    const period = createAnalyticsPeriod(selection, now)

    // Assert: Historical month boundaries remain full-month boundaries.
    expect(period.startUtc).toEqual(new Date(2026, 4, 1))
    expect(period.endUtc).toEqual(new Date(2026, 5, 1))
    expect(period.isInProgress).toBe(false)
  })

  it('uses local midnight instants across the Berlin spring DST transition', () => {
    // Arrange: Fix the instant after Berlin has entered daylight-saving time.
    process.env.TZ = 'Europe/Berlin'
    const now = new Date(2026, 2, 29, 12)

    // Act: Build a seven-day period.
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now)

    // Assert: Local calendar arithmetic spans seven dates despite the 23-hour day.
    expect(period.startUtc.toISOString()).toBe('2026-03-22T23:00:00.000Z')
    expect(period.endUtc.toISOString()).toBe('2026-03-29T22:00:00.000Z')
  })

  it('uses local midnight instants across the Berlin autumn DST transition', () => {
    // Arrange: Fix the instant on the day Berlin leaves daylight-saving time.
    process.env.TZ = 'Europe/Berlin'
    const now = new Date(2026, 9, 25, 12)

    // Act: Build a seven-day period spanning the 25-hour local day.
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, now)

    // Assert: The range follows local midnight and spans 169 elapsed hours.
    expect(period.startUtc.toISOString()).toBe('2026-10-18T22:00:00.000Z')
    expect(period.endUtc.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(period.endUtc.getTime() - period.startUtc.getTime()).toBe(169 * 60 * 60 * 1000)
  })

})
