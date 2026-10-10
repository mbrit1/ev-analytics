import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { createAnalyticsPeriod } from './analyticsPeriods'
import { calculateSessionSpendingTrend } from './sessionSpendingTrend'
import type { SessionSpendingTrend } from './sessionSpendingTrend'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'

function buildSession(timestamp: Date, totalCost: number, id: string = crypto.randomUUID()): Extract<ChargingSession, { session_mode: 'plan' }> {
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

function expectChart(trend: SessionSpendingTrend | null): SessionSpendingTrend {
  expect(trend).not.toBeNull()
  return trend!
}

/** Verifies local bucket boundaries and shared cost validity semantics. */
describe('calculateSessionSpendingTrend', () => {
  const originalTimeZone = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin'
  })

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
    vi.resetModules()
  })

  it.each(['7-days', '30-days'] as const)('omits the chart for the %s preset', (preset) => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'preset', preset }, new Date(2026, 2, 31, 12))

    // Act
    const trend = calculateSessionSpendingTrend([], period)

    // Assert
    expect(trend).toBeNull()
  })

  it('uses monthly buckets across leap year boundaries and clips a trailing partial month', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, new Date(2024, 2, 10, 12))

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([
      buildSession(new Date(2023, 11, 10, 12), 999),
      buildSession(new Date(2023, 11, 11, 12), 111),
      buildSession(new Date(2024, 0, 31, 12), 222),
      buildSession(new Date(2024, 1, 29, 12), 333),
      buildSession(new Date(2024, 2, 10, 12), 444),
    ], period))

    // Assert
    expect(trend.buckets).toHaveLength(4)
    expect(trend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents)).toEqual([111, 222, 333, 444])
    expect(trend.buckets.map(({ isPartialMonth }) => isPartialMonth)).toEqual([true, false, false, true])
    expect(trend).toMatchObject({ startUtc: period.startUtc, endUtc: period.endUtc, selectedMonth: null })
    expect(trend.buckets).toMatchObject([
      { month: { year: 2023, month: 11 } }, { month: { year: 2024, month: 0 } },
      { month: { year: 2024, month: 1 } }, { month: { year: 2024, month: 2 } },
    ])
    expect(trend.buckets.at(-1)?.endUtc).toEqual(period.endUtc)
  })

  it('starts at a clamped month edge and includes the exact start while excluding the exclusive end', () => {
    // Arrange: Three months back from May 31 clamps to February 28 in 2026.
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, new Date(2026, 4, 30, 12))
    const sessions = [
      buildSession(new Date(period.startUtc.getTime() - 1), 100, 'before'),
      buildSession(period.startUtc, 200, 'start'),
      buildSession(new Date(period.endUtc.getTime() - 1), 300, 'last-instant'),
      buildSession(period.endUtc, 400, 'exclusive-end'),
    ]

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))

    // Assert
    expect(period.startUtc.getMonth()).toBe(1)
    expect(period.startUtc.getDate()).toBe(28)
    expect(trend).toMatchObject({ startUtc: period.startUtc, endUtc: period.endUtc, selectedMonth: null })
    expect(trend.buckets[0]).toMatchObject({ isPartialMonth: true, totalSessionSpendCents: 200, sessionCount: 1 })
    expect(trend.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: 300, sessionCount: 1 })
    expect(trend.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(500)
  })

  it('assigns exact month-boundary instants to the following historical bucket', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 4 } }, new Date(2026, 6, 1, 12))
    const sessions = [
      buildSession(new Date(2026, 3, 30, 23, 59, 59, 999), 100, 'before-month'),
      buildSession(new Date(2026, 4, 1, 0, 0, 0, 0), 200, 'month-start'),
      buildSession(new Date(2026, 4, 31, 23, 59, 59, 999), 300, 'month-last-instant'),
      buildSession(period.endUtc, 400, 'exclusive-end'),
    ]

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))

    // Assert
    expect(trend.buckets).toEqual(expect.arrayContaining([
      expect.objectContaining({ month: { year: 2026, month: 3 }, totalSessionSpendCents: 100, sessionCount: 1 }),
      expect.objectContaining({ month: { year: 2026, month: 4 }, totalSessionSpendCents: 500, sessionCount: 2 }),
    ]))
    expect(trend.buckets.at(-1)?.endUtc).toEqual(period.endUtc)
  })

  it('keeps empty/free values zero, invalid values unavailable, and excludes deleted sessions', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '3-months' }, new Date(2026, 5, 10, 12))
    const sessions = [
      buildSession(new Date(2026, 3, 4, 12), 0, 'free'),
      buildSession(new Date(2026, 4, 5, 12), 500, 'valid'),
      buildSession(new Date(2026, 4, 5, 13), Number.NaN, 'invalid'),
      buildSession(new Date(2026, 5, 6, 12), 900, 'deleted'),
    ]
    sessions[3]!.deleted_at = new Date(2026, 5, 7, 12)

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))

    // Assert
    expect(trend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents)).toEqual([0, 0, null, 0])
    expect(trend.buckets.map(({ sessionCount }) => sessionCount)).toEqual([0, 1, 2, 0])
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])('marks invalid recorded cost %s unavailable', (cost) => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const session = buildSession(new Date(2026, 5, 10, 12), cost, 'invalid')

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([session], period))

    // Assert
    expect(trend.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: null, sessionCount: 1 })
  })

  it.each([
    ['empty', [], true, 0],
    ['free', [buildSession(new Date(2026, 5, 10, 12), 0, 'free')], false, 1],
  ] as const)('distinguishes %s chart data from positive spend', (_label, sessions, isEmpty, sessionCount) => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))

    // Assert
    expect(trend).toMatchObject({ isEmpty })
    expect(trend.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: 0, sessionCount })
  })

  it('reconciles monthly bucket totals to the selected-period aggregation', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const sessions = [
      buildSession(new Date(2026, 4, 15, 12), 700),
      buildSession(new Date(2026, 5, 1, 12), 1200),
      buildSession(new Date(2026, 5, 30, 12), 3400),
      buildSession(new Date(2026, 6, 1, 12), 9999),
    ]

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))

    // Assert
    expect(trend.buckets.at(-1)?.totalSessionSpendCents).toBe(4600)
    expect(trend.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(5300)
    expect(trend.buckets.at(-1)?.totalSessionSpendCents).toBe(calculateMonthlySessionSpend(sessions, period).totalSessionSpendCents)
    expect(trend).toMatchObject({ selectedMonth: { year: 2026, month: 5 } })
  })

  it('keeps the calendar-month anchor independent of a trailing partial month', () => {
    // Arrange: The current month is fully covered on its final calendar day.
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 4 } }, new Date(2026, 4, 31, 12))

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([], period))

    // Assert
    expect(trend).toMatchObject({ selectedMonth: { year: 2026, month: 4 } })
    expect(trend.buckets.at(-1)).toMatchObject({ isPartialMonth: false, isCurrentMonth: true, month: { year: 2026, month: 4 } })
  })

  it('does not mark a historical selected month as current', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 4 } }, new Date(2026, 5, 1, 12))

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([], period))

    // Assert
    expect(trend.buckets.at(-1)).toMatchObject({ isPartialMonth: false, isCurrentMonth: false, month: { year: 2026, month: 4 } })
  })

  it.each(['3-months', 'year'] as const)('keeps the full current month on the last day for %s', (preset) => {
    // Arrange: The period ends at midnight on June 1 after covering all of May.
    const period = createAnalyticsPeriod({ kind: 'preset', preset }, new Date(2026, 4, 31, 12))

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([], period))

    // Assert
    expect(trend).toMatchObject({ selectedMonth: null, endUtc: new Date(2026, 5, 1) })
    expect(trend.buckets.at(-1)).toMatchObject({
      month: { year: 2026, month: 4 }, startUtc: new Date(2026, 4, 1), endUtc: new Date(2026, 5, 1),
      isPartialMonth: false, isCurrentMonth: true,
    })
    expect(trend.buckets.slice(0, -1)).toMatchObject(
      Array.from({ length: trend.buckets.length - 1 }, () => ({ isCurrentMonth: false })),
    )
  })

  it.each([
    ['current six-month context over a year boundary', new Date(2026, 0, 15, 12), [2025, 7], [2026, 0]],
    ['historical six-month context over leap day', new Date(2024, 3, 1, 12), [2023, 9], [2024, 2]],
  ] as const)('builds six calendar buckets for %s', (_label, anchor, first, last) => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: last[0], month: last[1] } }, anchor)

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([], period))

    // Assert
    expect(trend.buckets).toHaveLength(6)
    expect(trend).toMatchObject({
      unit: 'month', startUtc: new Date(first[0], first[1], 1), endUtc: period.endUtc,
      selectedMonth: { year: last[0], month: last[1] },
    })
    expect(trend.buckets[0]).toMatchObject({
      month: { year: first[0], month: first[1] }, startUtc: new Date(first[0], first[1], 1),
      endUtc: new Date(first[0], first[1] + 1, 1), isPartialMonth: false, isCurrentMonth: false,
    })
    expect(trend.buckets.map(({ startUtc }) => [startUtc.getFullYear(), startUtc.getMonth()]))
      .toEqual(Array.from({ length: 6 }, (_, index) => {
        const month = new Date(first[0], first[1] + index, 1)
        return [month.getFullYear(), month.getMonth()]
      }))
    expect(trend.buckets.at(-1)).toMatchObject({ month: { year: last[0], month: last[1] } })
    expect(trend.buckets.at(-1)?.endUtc).toEqual(period.endUtc)
    expect(trend.buckets.slice(0, -1)).toMatchObject(Array.from({ length: 5 }, () => ({ isPartialMonth: false, isCurrentMonth: false })))
  })

  it.each([
    ['3-months', '3-months', 4],
    ['year', 'year', 13],
  ] as const)('keeps %s rolling bounds and local month boundaries through DST', (_label, preset, expectedBuckets) => {
    // Arrange: Spring and autumn DST changes both occur within this year range.
    const anchor = new Date(2026, 9, 27, 12)
    const period = createAnalyticsPeriod({ kind: 'preset', preset }, anchor)

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([], period))

    // Assert
    expect(trend.buckets).toHaveLength(expectedBuckets)
    expect(trend).toMatchObject({ startUtc: period.startUtc, endUtc: period.endUtc })
    expect(trend.buckets[0]?.startUtc).toEqual(period.startUtc)
    expect(trend.buckets.at(-1)?.endUtc).toEqual(period.endUtc)
    expect(trend.buckets.slice(1).map(({ startUtc }) => startUtc.getTime()))
      .toEqual(trend.buckets.slice(0, -1).map(({ endUtc }) => endUtc.getTime()))
    expect(trend.buckets.at(-1)).toMatchObject({ month: { year: 2026, month: 9 } })
  })

  it.each([
    [2, 31 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000],
    [9, 31 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000],
  ] as const)('uses local midnight boundaries for DST month %s', (month, expectedDuration) => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month } }, new Date(2026, month + 1, 15, 12))

    // Act
    const trend = expectChart(calculateSessionSpendingTrend([], period))

    // Assert
    const bucket = trend.buckets.at(-1)!
    expect(bucket).toMatchObject({ isPartialMonth: false, isCurrentMonth: false })
    expect(bucket.endUtc.getTime() - bucket.startUtc.getTime()).toBe(expectedDuration)
    expect([bucket.startUtc.getHours(), bucket.startUtc.getMinutes()]).toEqual([0, 0])
    expect([bucket.endUtc.getHours(), bucket.endUtc.getMinutes()]).toEqual([0, 0])
  })

  it('clips the current month at tomorrow while including all sessions through today', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 5, 10, 12))
    const originalPeriodBounds = { startUtc: new Date(period.startUtc), endUtc: new Date(period.endUtc) }
    const sessions = [
      buildSession(new Date(2025, 11, 31, 12), 100, 'before-chart'),
      buildSession(new Date(2026, 0, 1, 0), 200, 'chart-start'),
      buildSession(new Date(period.endUtc.getTime() - 1), 300, 'today'),
      buildSession(new Date(2026, 5, 11, 0), 400, 'tomorrow'),
      buildSession(new Date(2026, 6, 1, 0), 500, 'later'),
    ]

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))

    // Assert
    expect(trend.buckets).toHaveLength(6)
    expect(trend).toMatchObject({ endUtc: new Date(2026, 5, 11), selectedMonth: { year: 2026, month: 5 } })
    expect(trend.buckets.at(-1)).toMatchObject({ totalSessionSpendCents: 300, sessionCount: 1, isPartialMonth: true, isCurrentMonth: true })
    expect(trend.buckets[0]).toMatchObject({ totalSessionSpendCents: 200, sessionCount: 1 })
    expect(trend.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(500)
    expect(period.startUtc).toEqual(originalPeriodBounds.startUtc)
    expect(period.endUtc).toEqual(originalPeriodBounds.endUtc)
  })

  it.each([
    ['3-months', '3-months', 4],
    ['year', 'year', 13],
  ] as const)('reconciles every %s rolling bucket with exact inclusive and exclusive bounds', (_label, preset, expectedBuckets) => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'preset', preset }, new Date(2026, 9, 27, 12))
    const sessions = [
      buildSession(period.startUtc, 100, 'start'),
      buildSession(new Date(2026, 7, 1, 0), 200, 'month-boundary'),
      buildSession(new Date(period.endUtc.getTime() - 1), 300, 'last-instant'),
      buildSession(period.endUtc, 400, 'exclusive-end'),
    ]

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))
    const summary = calculateMonthlySessionSpend(sessions, period)

    // Assert
    expect(trend.buckets).toHaveLength(expectedBuckets)
    expect(trend.buckets[0]).toMatchObject({ isPartialMonth: true })
    expect(trend.buckets.at(-1)).toMatchObject({ isPartialMonth: true, isCurrentMonth: true })
    expect(trend.buckets.reduce((sum, bucket) => sum + (bucket.totalSessionSpendCents ?? 0), 0)).toBe(summary.totalSessionSpendCents)
    expect(trend.buckets.reduce((sum, bucket) => sum + bucket.sessionCount, 0)).toBe(summary.sessionCount)
  })

  it('keeps an invalid context bucket unavailable without poisoning the selected summary', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const sessions = [
      buildSession(new Date(2026, 4, 10, 12), Number.NaN, 'invalid-context'),
      buildSession(new Date(2026, 5, 10, 12), 1200, 'selected-month'),
    ]

    // Act
    const trend = expectChart(calculateSessionSpendingTrend(sessions, period))
    const summary = calculateMonthlySessionSpend(sessions, period)

    // Assert
    expect(trend.buckets).toHaveLength(6)
    expect(trend.buckets[4]).toMatchObject({ month: { year: 2026, month: 4 }, totalSessionSpendCents: null })
    expect(trend.buckets[5]).toMatchObject({ month: { year: 2026, month: 5 }, totalSessionSpendCents: 1200 })
    expect(summary.totalSessionSpendCents).toBe(1200)
    expect(trend).toMatchObject({ selectedMonth: { year: 2026, month: 5 } })
  })

  it('keeps recorded cost independent of current pricing metadata', () => {
    // Arrange: Preserve recorded cents while changing fee and current ad-hoc pricing metadata.
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 5 } }, new Date(2026, 6, 1))
    const recorded = buildSession(new Date(2026, 5, 10, 12), 1234)
    const laterMetadata = {
      ...recorded,
      applied_session_fee: 999,
      provider_name_snapshot: 'Renamed provider',
      tariff_plan_id: 'new-plan',
      pricing_context: 'roaming' as const,
      price_snapshot: { label: 'Current plan', kWhPrice: 999, sessionFee: 999 },
    }

    // Act
    const originalTrend = expectChart(calculateSessionSpendingTrend([recorded], period))
    const changedMetadataTrend = expectChart(calculateSessionSpendingTrend([laterMetadata], period))

    // Assert
    expect(changedMetadataTrend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents))
      .toEqual(originalTrend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents))
    expect(changedMetadataTrend.buckets).toHaveLength(6)
    expect(changedMetadataTrend.buckets.at(-1)?.totalSessionSpendCents).toBe(1234)
  })

  it('carries a year period across calendar years', () => {
    // Arrange
    const yearPeriod = createAnalyticsPeriod({ kind: 'preset', preset: 'year' }, new Date(2026, 0, 15, 12))

    // Act
    const yearTrend = expectChart(calculateSessionSpendingTrend([], yearPeriod))

    // Assert
    expect(yearTrend.buckets.map(({ startUtc }) => startUtc.getMonth()).slice(0, 3)).toEqual([0, 1, 2])
    expect(yearTrend.buckets[0]?.startUtc.getFullYear()).toBe(2025)
  })
})
