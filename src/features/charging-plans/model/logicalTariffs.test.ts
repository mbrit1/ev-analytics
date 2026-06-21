import { describe, expect, it } from 'vitest'
import type { ChargingPlan } from './types'
import {
  buildLogicalTariffs,
  getLogicalTariffKey,
  resolveEffectivePlanForDate,
} from './logicalTariffs'

const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`)

const buildPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: 'plan-1',
  user_id: 'user-1',
  provider_id: 'provider-1',
  name: 'Base Plan',
  valid_from: utc('2026-01-01'),
  valid_to: null,
  ac_price_per_kwh: 49,
  dc_price_per_kwh: 59,
  roaming_ac_price_per_kwh: 69,
  roaming_dc_price_per_kwh: 79,
  monthly_base_fee: 0,
  session_fee: 0,
  affiliation: 'member',
  notes: 'fixture',
  created_at: utc('2026-01-01'),
  updated_at: utc('2026-01-01'),
  ...overrides,
})

const buildPromotionChain = (): ChargingPlan[] => [
  buildPlan({
    id: 'base',
    valid_from: utc('2026-01-01'),
    valid_to: utc('2026-08-01'),
    ac_price_per_kwh: 49,
    dc_price_per_kwh: 59,
    roaming_ac_price_per_kwh: 69,
    roaming_dc_price_per_kwh: 79,
    monthly_base_fee: 499,
    session_fee: 99,
  }),
  buildPlan({
    id: 'promo',
    valid_from: utc('2026-08-01'),
    valid_to: utc('2026-09-01'),
    ac_price_per_kwh: 39,
    dc_price_per_kwh: 49,
    roaming_ac_price_per_kwh: 59,
    roaming_dc_price_per_kwh: 69,
    monthly_base_fee: 199,
    session_fee: 0,
  }),
  buildPlan({
    id: 'restore',
    valid_from: utc('2026-09-01'),
    valid_to: null,
    ac_price_per_kwh: 49,
    dc_price_per_kwh: 59,
    roaming_ac_price_per_kwh: 69,
    roaming_dc_price_per_kwh: 79,
    monthly_base_fee: 499,
    session_fee: 99,
  }),
]

/** Test suite for logical tariff grouping and date-derived version roles. */
describe('logicalTariffs', () => {
  it('groups provider plus normalized name and resolves the effective boundary', () => {
    // Arrange: Build two adjacent versions whose names differ only by normalization.
    const versions = [
      buildPlan({ id: 'base', name: ' Lidl ', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'next', name: 'lidl', valid_from: utc('2026-08-15'), valid_to: null }),
    ]

    // Act: Resolve the logical key, boundary dates, and grouped logical tariffs.
    const logicalKey = getLogicalTariffKey(versions[0])
    const beforeBoundary = resolveEffectivePlanForDate(versions, utc('2026-08-14'))
    const onBoundary = resolveEffectivePlanForDate(versions, utc('2026-08-15'))
    const logicalTariffsBeforeBoundary = buildLogicalTariffs(versions, utc('2026-08-14'))
    const logicalTariffs = buildLogicalTariffs(versions, utc('2026-08-15'))

    // Assert: Identity is normalized and the half-open validity boundary switches on valid_to.
    expect(logicalKey).toBe('provider-1::lidl')
    expect(beforeBoundary?.id).toBe('base')
    expect(onBoundary?.id).toBe('next')
    expect(logicalTariffs).toHaveLength(1)
    expect(logicalTariffs[0]?.name).toBe('Lidl')
    expect(logicalTariffsBeforeBoundary[0]?.badge).toEqual({
      kind: 'upcoming_change',
      date: '2026-08-15',
      label: 'Changes on 15 Aug',
    })
    expect(logicalTariffsBeforeBoundary[0]?.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-08-15',
      label: 'Next Update · 15 Aug 2026',
      changes: [],
    })
  })

  it('hides upcoming changes that are beyond the indicator threshold', () => {
    // Arrange: Build a current version and a successor more than 30 days away.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-08-20'),
        dc_price_per_kwh: 49,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-08-20'),
        valid_to: null,
        dc_price_per_kwh: 59,
      }),
    ]

    // Act: Build logical tariffs more than 30 UTC days before the next version.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: No upcoming visibility is exposed on the card.
    expect(logical.upcomingVisibility).toEqual({ kind: 'none' })
  })

  it('exposes an indicator when the next change is between 8 and 30 days away', () => {
    // Arrange: Build a successor 17 UTC days in the future.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-07-18'),
        dc_price_per_kwh: 49,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-18'),
        valid_to: null,
        dc_price_per_kwh: 59,
      }),
    ]

    // Act: Build logical tariffs inside the indicator window.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: The upcoming change is reduced to a quiet indicator.
    expect(logical.upcomingVisibility).toEqual({
      kind: 'indicator',
      effectiveDate: '2026-07-18',
      label: 'Update scheduled · 18 Jul 2026',
    })
  })

  it('exposes a preview with only changed price categories inside the preview window', () => {
    // Arrange: Build a successor within 7 UTC days and change only DC fields.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-07-06'),
        ac_price_per_kwh: 29,
        dc_price_per_kwh: 49,
        roaming_dc_price_per_kwh: 59,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-06'),
        valid_to: null,
        ac_price_per_kwh: 29,
        dc_price_per_kwh: 53,
        roaming_dc_price_per_kwh: 63,
      }),
    ]

    // Act: Build logical tariffs inside the preview window.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: Only changed categories appear in the preview copy.
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-06',
      label: 'Next Update · 06 Jul 2026',
      changes: [
        { label: 'Domestic DC', valueCents: 53 },
        { label: 'Roaming DC', valueCents: 63 },
      ],
    })
  })

  it('does not treat affiliation changes as price preview changes', () => {
    // Arrange: Build a successor that only changes descriptive metadata.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-07-06'),
        dc_price_per_kwh: 49,
        affiliation: 'member',
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-06'),
        valid_to: null,
        dc_price_per_kwh: 49,
        affiliation: 'fleet',
      }),
    ]

    // Act: Build logical tariffs inside the preview window.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: Non-price metadata does not create preview rows.
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-06',
      label: 'Next Update · 06 Jul 2026',
      changes: [],
    })
  })

  it('shows removals of optional price fields in the preview', () => {
    // Arrange: Build a successor that removes a roaming price after the current version.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-07-06'),
        roaming_ac_price_per_kwh: 69,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-06'),
        valid_to: null,
        roaming_ac_price_per_kwh: undefined,
      }),
    ]

    // Act: Build logical tariffs inside the preview window.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: The removed field stays visible as a changed preview row.
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-06',
      label: 'Next Update · 06 Jul 2026',
      changes: [
        { label: 'Roaming AC', valueCents: null },
      ],
    })
  })

  it('applies the upcoming visibility thresholds at exact UTC day cutoffs', () => {
    // Arrange: Build a shared tariff pair and a table of cutoff cases.
    const cases = [
      {
        daysUntilChange: 0,
        expected: {
          kind: 'preview' as const,
          effectiveDate: '2026-07-01',
          label: 'Next Update · 01 Jul 2026',
          changes: [{ label: 'Domestic DC', valueCents: 59 }],
        },
      },
      {
        daysUntilChange: 7,
        expected: {
          kind: 'preview' as const,
          effectiveDate: '2026-07-08',
          label: 'Next Update · 08 Jul 2026',
        },
      },
      {
        daysUntilChange: 8,
        expected: {
          kind: 'indicator' as const,
          effectiveDate: '2026-07-09',
          label: 'Update scheduled · 09 Jul 2026',
        },
      },
      {
        daysUntilChange: 30,
        expected: {
          kind: 'indicator' as const,
          effectiveDate: '2026-07-31',
          label: 'Update scheduled · 31 Jul 2026',
        },
      },
      {
        daysUntilChange: 31,
        expected: {
          kind: 'none' as const,
        },
      },
    ]

    for (const { daysUntilChange, expected } of cases) {
      // Act: Build logical tariffs at the exact UTC cutoff being verified.
      const changeDate = utc('2026-07-01')
      changeDate.setUTCDate(changeDate.getUTCDate() + daysUntilChange)
      const versions = [
        buildPlan({
          id: `current-${daysUntilChange}`,
          valid_from: utc('2026-01-01'),
          valid_to: changeDate,
          dc_price_per_kwh: 49,
        }),
        buildPlan({
          id: `future-${daysUntilChange}`,
          valid_from: changeDate,
          valid_to: null,
          dc_price_per_kwh: 59,
        }),
      ]

      const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

      // Assert: Each cutoff lands in the intended visibility bucket.
      expect(logical.upcomingVisibility.kind).toBe(expected.kind)
      expect(logical.upcomingVisibility).toMatchObject(expected)
    }
  })

  it('hides same-day preview for a first version without a predecessor', () => {
    // Arrange: Build a tariff whose first version starts today and has no prior version.
    const versions = [
      buildPlan({
        id: 'first',
        valid_from: utc('2026-07-01'),
        valid_to: null,
        dc_price_per_kwh: 59,
      }),
    ]

    // Act: Build logical tariffs on the first version's start date.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: No preview is emitted without a predecessor to compare against.
    expect(logical.upcomingVisibility).toEqual({ kind: 'none' })
  })

  it('shows upcoming visibility for a first version starting in three days', () => {
    // Arrange: Build a tariff whose first version starts in three days and has no predecessor.
    const versions = [
      buildPlan({
        id: 'first',
        valid_from: utc('2026-07-04'),
        valid_to: null,
        dc_price_per_kwh: 59,
      }),
    ]

    // Act: Build logical tariffs before the first version becomes effective.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: The first upcoming version is still surfaced as preview visibility.
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-04',
      label: 'Next Update · 04 Jul 2026',
      changes: [
        { label: 'Domestic AC', valueCents: 49 },
        { label: 'Domestic DC', valueCents: 59 },
        { label: 'Roaming AC', valueCents: 69 },
        { label: 'Roaming DC', valueCents: 79 },
        { label: 'Monthly Base Fee', valueCents: 0 },
        { label: 'Session Fee', valueCents: 0 },
      ],
    })
  })

  it('falls through to a later future version when the first same-day version has no predecessor', () => {
    // Arrange: Build a first version that starts today plus another version three days later.
    const versions = [
      buildPlan({
        id: 'today',
        valid_from: utc('2026-07-01'),
        valid_to: utc('2026-07-04'),
        dc_price_per_kwh: 59,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-04'),
        valid_to: null,
        dc_price_per_kwh: 69,
      }),
    ]

    // Act: Build logical tariffs on the day the first version begins.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: The same-day first version is skipped and the later real upcoming change is surfaced.
    expect(logical.currentVersion?.id).toBe('today')
    expect(logical.nextVersion?.id).toBe('future')
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-04',
      label: 'Next Update · 04 Jul 2026',
      changes: [{ label: 'Domestic DC', valueCents: 69 }],
    })
  })

  it('keeps same-day preview off the legacy badge while preserving the visibility preview', () => {
    // Arrange: Build a successor that starts today after a prior version ends yesterday.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-07-01'),
        dc_price_per_kwh: 49,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-01'),
        valid_to: null,
        dc_price_per_kwh: 59,
      }),
    ]

    // Act: Build logical tariffs on the day the successor becomes effective.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: Visibility previews the change, but the temporary legacy badge stays hidden.
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-01',
      label: 'Next Update · 01 Jul 2026',
      changes: [{ label: 'Domestic DC', valueCents: 59 }],
    })
    expect(logical.badge).toBeUndefined()
  })

  it('keeps nextVersion strictly future-only on a same-day cutoff', () => {
    // Arrange: Build a tariff that changes today and again later in the future.
    const versions = [
      buildPlan({
        id: 'current',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-07-01'),
        dc_price_per_kwh: 49,
      }),
      buildPlan({
        id: 'today',
        valid_from: utc('2026-07-01'),
        valid_to: utc('2026-07-10'),
        dc_price_per_kwh: 59,
      }),
      buildPlan({
        id: 'future',
        valid_from: utc('2026-07-10'),
        valid_to: null,
        dc_price_per_kwh: 69,
      }),
    ]

    // Act: Build logical tariffs on the same day the middle version becomes active.
    const [logical] = buildLogicalTariffs(versions, utc('2026-07-01'))

    // Assert: The active same-day version is current, while nextVersion stays strictly future-only.
    expect(logical.currentVersion?.id).toBe('today')
    expect(logical.nextVersion?.id).toBe('future')
    expect(logical.upcomingVisibility).toEqual({
      kind: 'preview',
      effectiveDate: '2026-07-01',
      label: 'Next Update · 01 Jul 2026',
      changes: [{ label: 'Domestic DC', valueCents: 59 }],
    })
  })

  it('classifies promotion and restoration independently of current date', () => {
    // Arrange: Build a base -> promo -> restore chain with the original pricing restored afterward.
    const versions = buildPromotionChain()

    // Act: Build the logical tariff while the promotion is active.
    const [logical] = buildLogicalTariffs(versions, utc('2026-08-20'))

    // Assert: The active promotion gets a promo badge and history labels include both role and state.
    expect(logical.badge).toEqual({
      kind: 'promo',
      date: '2026-08-31',
      label: 'Promo until 31 Aug',
    })
    expect(logical.history.find((row) => row.plan.id === 'promo')?.labels).toEqual(['Promotion', 'Current'])
    expect(logical.history.find((row) => row.plan.id === 'restore')?.labels).toEqual(['Restored', 'Scheduled'])
  })

  it('labels an active restored version as restored and current', () => {
    // Arrange: Reuse the same promotion chain after the restoration has become active.
    const versions = buildPromotionChain()

    // Act: Build the logical tariff after the restoration boundary.
    const [logical] = buildLogicalTariffs(versions, utc('2026-09-02'))

    // Assert: The restored version keeps its restoration role while also being current.
    expect(logical.history.find((row) => row.plan.id === 'restore')?.labels).toEqual(['Restored', 'Current'])
  })

  it('returns no effective version for a gap', () => {
    // Arrange: Build two versions with a validity gap between them.
    const versions = [
      buildPlan({ id: 'early', valid_from: utc('2026-01-01'), valid_to: utc('2026-03-01') }),
      buildPlan({ id: 'late', valid_from: utc('2026-05-01'), valid_to: null }),
    ]

    // Act: Resolve the effective plan inside the gap.
    const effective = resolveEffectivePlanForDate(versions, utc('2026-04-01'))

    // Assert: No version is effective during the uncovered period.
    expect(effective).toBeNull()
  })

  it('keeps an unnamed tariff as a valid provider-scoped identity', () => {
    // Arrange: Build a whitespace-only tariff name for a real provider.
    const versions = [
      buildPlan({ id: 'unnamed', provider_id: 'provider-1', name: '   ' }),
    ]

    // Act: Derive the logical key and grouped logical tariff.
    const logicalKey = getLogicalTariffKey(versions[0])
    const [logical] = buildLogicalTariffs(versions, utc('2026-06-13'))

    // Assert: Unnamed tariffs still group correctly within the provider scope.
    expect(logicalKey).toBe('provider-1::')
    expect(logical.name).toBe('')
  })

  it('hydrates iso string dates before grouping logical tariffs', () => {
    // Arrange: Simulate plans hydrated from local sync with serialized ISO dates.
    const versions = [
      buildPlan({
        id: 'base',
        valid_from: '2026-01-01T00:00:00.000Z' as unknown as Date,
        valid_to: '2026-08-15T00:00:00.000Z' as unknown as Date,
        created_at: '2026-01-01T00:00:00.000Z' as unknown as Date,
        updated_at: '2026-01-01T00:00:00.000Z' as unknown as Date,
      }),
      buildPlan({
        id: 'next',
        valid_from: '2026-08-15T00:00:00.000Z' as unknown as Date,
        valid_to: null,
        created_at: '2026-08-15T00:00:00.000Z' as unknown as Date,
        updated_at: '2026-08-15T00:00:00.000Z' as unknown as Date,
      }),
    ]

    // Act: Build grouped tariffs and resolve the active version on the boundary.
    const [logical] = buildLogicalTariffs(versions, utc('2026-08-15'))

    // Assert: Serialized dates are coerced back into Date objects before comparison.
    expect(logical.currentVersion?.id).toBe('next')
    expect(logical.versions.every((plan) => plan.valid_from instanceof Date)).toBe(true)
    expect(logical.history[0]?.startDate).toBe('2026-01-01')
  })
})
