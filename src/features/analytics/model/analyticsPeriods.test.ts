import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
})
