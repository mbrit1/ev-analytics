import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from './analyticsPeriods'
import { comparePreviousPeriod } from './previousPeriodComparison'

/**
 * Verifies local mock sessions populate current and previous analytics windows
 * across calendar boundaries, timezone offsets, and daylight-saving changes.
 */
describe('mock comparison seed', () => {
  const originalTimeZone = process.env.TZ

  afterEach(() => {
    vi.useRealTimers()
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
    vi.resetModules()
  })

  it.each([
    { timeZone: 'Europe/Berlin', now: '2026-03-01T11:00:00.000Z' },
    { timeZone: 'Europe/Berlin', now: '2026-03-31T11:00:00.000Z' },
    { timeZone: 'Pacific/Kiritimati', now: '2026-03-31T10:00:00.000Z' },
    { timeZone: 'Etc/GMT+12', now: '2026-05-31T12:00:00.000Z' },
    { timeZone: 'UTC', now: '2026-02-28T12:00:00.000Z' },
    { timeZone: 'Europe/Berlin', now: '2024-03-01T11:00:00.000Z' },
    { timeZone: 'UTC', now: '2025-01-01T12:00:00.000Z' },
  ])('seeds comparable current and previous ranges in $timeZone at $now', async ({ timeZone, now }) => {
    // Arrange: Rebuild date-dependent mock seed under a fixed clock and local timezone.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    process.env.TZ = timeZone
    vi.resetModules()

    const { mockChargingPlans, mockSessions } = await import('../../../mocks/seed-data')
    const sessions = mockSessions.map((session) => ({
      ...session,
      session_timestamp: new Date(session.session_timestamp),
      created_at: new Date(session.created_at),
      updated_at: new Date(session.updated_at),
    })) as ChargingSession[]
    const fixedNow = new Date(now)
    const modes = [
      { kind: 'preset' as const, preset: '7-days' as const },
      { kind: 'preset' as const, preset: '30-days' as const },
      { kind: 'month' as const, month: { year: fixedNow.getFullYear(), month: fixedNow.getMonth() } },
    ]

    // Act: Aggregate seeded sessions in each current and immediately preceding window.
    const comparisons = modes.map((selection) => {
      const currentPeriod = createAnalyticsPeriod(selection, fixedNow)
      const previousPeriod = createPreviousAnalyticsPeriod(currentPeriod)
      const current = calculateMonthlySessionSpend(sessions, currentPeriod)
      const previous = calculateMonthlySessionSpend(sessions, {
        startUtc: previousPeriod.startUtc,
        endUtc: previousPeriod.endUtc,
        isCurrentMonth: false,
        isCompleteMonth: false,
      })
      return { current, previous, previousPeriod, comparison: comparePreviousPeriod(current, previous, currentPeriod, previousPeriod) }
    })

    // Assert: Each selected mode has recorded data and yields a valid comparison.
    expect(comparisons).toHaveLength(3)
    for (const { current, previous, comparison } of comparisons) {
      expect(current.sessionCount).toBeGreaterThan(0)
      expect(previous.sessionCount).toBeGreaterThan(0)
      expect(current.totalSessionSpendCents).toBeGreaterThan(0)
      expect(previous.totalSessionSpendCents).toBeGreaterThan(0)
      expect(current.billedEnergyKwh).toBeGreaterThan(0)
      expect(previous.billedEnergyKwh).toBeGreaterThan(0)
      expect(comparison.status).toBe('compared')
      expect(comparison.priceDifferenceEurPerKwh).not.toBeNull()
    }
    expect(comparisons[0].comparison.spending.status).toBe('percentage')
    expect(comparisons[0].comparison.energy.status).toBe('percentage')
    expect(comparisons[1].comparison.spending.status).toBe('percentage')
    expect(comparisons[1].comparison.energy.status).toBe('percentage')
    if (comparisons[2].previousPeriod.isDayCountEqual) {
      expect(comparisons[2].comparison.spending.status).toBe('percentage')
      expect(comparisons[2].comparison.energy.status).toBe('percentage')
    }

    const comparisonSessions = mockSessions.filter((session) => ['s9', 's10', 's11'].includes(session.id))
    expect(comparisonSessions).toHaveLength(3)
    for (const session of comparisonSessions) {
      expect(session.session_mode).toBe('ad_hoc')
      expect(session.provider_id).toBeNull()
      expect(session.tariff_plan_id).toBeNull()
      expect(session.plan_selection_id).toBeNull()
      expect(session.pricing_context).toBe('ad_hoc')
      expect(session.ad_hoc_pricing?.pricePerKwh).toBe(45)
      expect(session.price_snapshot).toMatchObject({ label: 'Ad-Hoc', kWhPrice: 45, sessionFee: 0 })
      expect(session.total_cost).toBe(Math.round(session.kwh_billed * 45))
    }

    const timestamps = sessions.map((session) => new Date(session.session_timestamp).getTime())
    expect(new Set(sessions.map((session) => session.id)).size).toBe(sessions.length)
    expect(new Set(timestamps).size).toBe(sessions.length)
    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left))
    const planValidityDates = mockChargingPlans.flatMap((plan) => [plan.valid_from, plan.valid_to])
      .filter((date): date is Date => date instanceof Date)
    expect(planValidityDates.every((date) => date.toISOString().endsWith('T00:00:00.000Z'))).toBe(true)
  })
})
