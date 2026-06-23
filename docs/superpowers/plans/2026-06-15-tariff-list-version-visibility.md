# Tariff List Version Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved 3-state upcoming-version visibility model for tariff overview cards so far-future changes stay hidden, mid-range changes show a quiet indicator, and imminent changes show a compact changed-categories preview.

**Architecture:** Keep the visibility rules in the logical tariff model so the UI receives a precomputed card state instead of duplicating date math and diff logic in React. Update the tariff list component to render the new indicator or preview surface inside each card while preserving existing logical-tariff actions and the history sheet as a secondary surface.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, Vite

---

## File Map

- Modify: `src/features/charging-plans/model/logicalTariffs.ts`
  - Add upcoming-visibility types, UTC day-window logic, changed-category diffing, and remove non-price metadata from preview comparisons.
- Modify: `src/features/charging-plans/model/logicalTariffs.test.ts`
  - Add coverage for hidden, indicator, and preview states plus changed-category output.
- Modify: `src/features/charging-plans/components/TariffList.tsx`
  - Replace the existing generic upcoming badge rendering with indicator and preview rendering inside the tariff card.
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
  - Cover hidden, indicator, preview, changed-category-only output, and preserved base card content.

### Task 1: Logical Tariff Upcoming Visibility Model

**Files:**
- Modify: `src/features/charging-plans/model/logicalTariffs.ts`
- Modify: `src/features/charging-plans/model/logicalTariffs.test.ts`

- [ ] **Step 1: Write the failing model tests**

Add these tests to `src/features/charging-plans/model/logicalTariffs.test.ts` near the existing grouping and promotion coverage:

```ts
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
```

- [ ] **Step 2: Run the model test file and verify failure**

Run:

```bash
npm run test -- --run src/features/charging-plans/model/logicalTariffs.test.ts
```

Expected: FAIL with TypeScript or assertion errors because `LogicalTariff` does not expose `upcomingVisibility` yet and the existing upcoming badge model still returns `Changes on <date>`.

- [ ] **Step 3: Implement the logical upcoming-visibility model**

Update `src/features/charging-plans/model/logicalTariffs.ts` with these exports near the existing `LogicalTariffBadge` and `LogicalTariff` types:

```ts
export const PREVIEW_THRESHOLD_DAYS = 7
export const INDICATOR_THRESHOLD_DAYS = 30

export interface UpcomingTariffChange {
  label: 'Domestic AC' | 'Domestic DC' | 'Roaming AC' | 'Roaming DC' | 'Monthly Base Fee' | 'Session Fee'
  valueCents: number
}

export type LogicalTariffUpcomingVisibility =
  | { kind: 'none' }
  | { kind: 'indicator'; effectiveDate: string; label: string }
  | {
      kind: 'preview'
      effectiveDate: string
      label: string
      changes: UpcomingTariffChange[]
    }
```

Update `LogicalTariff` so it carries the new state:

```ts
export interface LogicalTariff {
  key: string
  providerId: string
  name: string
  versions: ChargingPlan[]
  currentVersion: ChargingPlan | null
  nextVersion: ChargingPlan | null
  badge?: LogicalTariffBadge
  upcomingVisibility: LogicalTariffUpcomingVisibility
  history: LogicalTariffHistoryRow[]
}
```

Add focused helpers below `formatDisplayDate`:

```ts
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const PRICE_PREVIEW_FIELDS = [
  ['ac_price_per_kwh', 'Domestic AC'],
  ['dc_price_per_kwh', 'Domestic DC'],
  ['roaming_ac_price_per_kwh', 'Roaming AC'],
  ['roaming_dc_price_per_kwh', 'Roaming DC'],
  ['monthly_base_fee', 'Monthly Base Fee'],
  ['session_fee', 'Session Fee'],
] as const

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

const getDaysUntilChange = (effectiveDate: Date, today: Date): number => {
  const msPerDay = 1000 * 60 * 60 * 24

  return Math.ceil(
    (startOfUtcDay(effectiveDate).getTime() - startOfUtcDay(today).getTime()) / msPerDay,
  )
}

const formatLongDisplayDate = (date: Date): string => FULL_DATE_FORMATTER.format(date)

const buildUpcomingChangePreview = (
  currentVersion: ChargingPlan,
  nextVersion: ChargingPlan,
): UpcomingTariffChange[] => (
  PRICE_PREVIEW_FIELDS.flatMap(([field, label]) => (
    currentVersion[field] === nextVersion[field] || nextVersion[field] == null
      ? []
      : [{ label, valueCents: nextVersion[field] }]
  ))
)

export const getTariffUpdateVisibility = (
  currentVersion: ChargingPlan | null,
  nextVersion: ChargingPlan | null,
  today: Date,
): LogicalTariffUpcomingVisibility => {
  if (!nextVersion) {
    return { kind: 'none' }
  }

  const daysUntilChange = getDaysUntilChange(nextVersion.valid_from, today)

  if (daysUntilChange < 0 || daysUntilChange > INDICATOR_THRESHOLD_DAYS) {
    return { kind: 'none' }
  }

  if (daysUntilChange > PREVIEW_THRESHOLD_DAYS) {
    return {
      kind: 'indicator',
      effectiveDate: formatUtcDate(nextVersion.valid_from),
      label: `Update scheduled · ${formatLongDisplayDate(nextVersion.valid_from)}`,
    }
  }

  return {
    kind: 'preview',
    effectiveDate: formatUtcDate(nextVersion.valid_from),
    label: `Next Update · ${formatLongDisplayDate(nextVersion.valid_from)}`,
    changes: currentVersion ? buildUpcomingChangePreview(currentVersion, nextVersion) : [],
  }
}
```

Then make two behavior changes in the existing model:

```ts
const PRICE_STRUCTURE_KEYS = [
  'ac_price_per_kwh',
  'dc_price_per_kwh',
  'roaming_ac_price_per_kwh',
  'roaming_dc_price_per_kwh',
  'monthly_base_fee',
  'session_fee',
] as const
```

```ts
const badgeIndex = currentIndex >= 0 && promotionIndexes.has(currentIndex) ? currentIndex : -1
const badge = badgeIndex >= 0 ? buildBadgeForVersion(versions, badgeIndex, promotionIndexes) : undefined
const upcomingVisibility = getTariffUpdateVisibility(currentVersion, nextVersion, today)

return {
  key,
  providerId: versions[0].provider_id,
  name: trimTariffName(versions[0].name),
  versions,
  currentVersion,
  nextVersion,
  upcomingVisibility,
  ...(badge ? { badge } : {}),
  history,
}
```

- [ ] **Step 4: Run the model test file and verify it passes**

Run:

```bash
npm run test -- --run src/features/charging-plans/model/logicalTariffs.test.ts
```

Expected: PASS with the new upcoming-visibility cases green and the promotion badge cases still passing.

- [ ] **Step 5: Commit the model task**

```bash
git add src/features/charging-plans/model/logicalTariffs.ts src/features/charging-plans/model/logicalTariffs.test.ts
git commit -m "feat(tariffs): derive card visibility for upcoming versions"
```

### Task 2: Tariff Card Indicator And Preview Rendering

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`

- [ ] **Step 1: Write the failing tariff list tests**

Add these tests to `src/features/charging-plans/components/TariffList.test.tsx` and extend the `buildLogicalTariff` fixture so it can accept `upcomingVisibility` overrides:

```ts
  it('shows no upcoming UI when the logical tariff visibility is none', () => {
    // Arrange: Render a logical tariff whose next change is intentionally hidden.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: { kind: 'none' },
        }),
      ],
    }))

    // Act: Render the tariff list.
    renderTariffList()

    // Assert: No update indicator or preview block is rendered.
    expect(screen.queryByText(/update scheduled/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/next update/i)).not.toBeInTheDocument()
  })

  it('shows a quiet upcoming indicator without future prices for indicator state', () => {
    // Arrange: Render a logical tariff inside the mid-range update window.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: {
            kind: 'indicator',
            effectiveDate: '2026-07-18',
            label: 'Update scheduled · 18 Jul 2026',
          },
        }),
      ],
    }))

    // Act: Render the tariff list.
    renderTariffList()

    // Assert: Only the indicator copy is visible.
    expect(screen.getByText('Update scheduled · 18 Jul 2026')).toBeInTheDocument()
    expect(screen.queryByText(/domestic dc 0,53 €/i)).not.toBeInTheDocument()
  })

  it('shows only changed categories in the preview state', () => {
    // Arrange: Render a logical tariff with an imminent next version.
    vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
      logicalTariffs: [
        buildLogicalTariff({
          badge: undefined,
          upcomingVisibility: {
            kind: 'preview',
            effectiveDate: '2026-07-06',
            label: 'Next Update · 06 Jul 2026',
            changes: [
              { label: 'Domestic DC', valueCents: 53 },
              { label: 'Roaming DC', valueCents: 63 },
            ],
          },
        }),
      ],
    }))

    // Act: Render the tariff list.
    renderTariffList()

    // Assert: The preview renders changed categories only and leaves unchanged ones out.
    expect(screen.getByText('Next Update · 06 Jul 2026')).toBeInTheDocument()
    expect(screen.getByText('Domestic DC 0,53 € · Roaming DC 0,63 €')).toBeInTheDocument()
    expect(screen.queryByText(/domestic ac 0,29 €/i)).not.toBeInTheDocument()
  })
```

Update the default fixture shape in `buildLogicalTariff`:

```ts
    upcomingVisibility: overrides.upcomingVisibility ?? {
      kind: 'indicator',
      effectiveDate: '2026-08-15',
      label: 'Update scheduled · 15 Aug 2026',
    },
```

- [ ] **Step 2: Run the tariff list test file and verify failure**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx
```

Expected: FAIL because `LogicalTariff` fixtures and `TariffList` rendering do not know about `upcomingVisibility` yet and the list still renders `logicalTariff.badge` for non-promo future changes.

- [ ] **Step 3: Render the new indicator and preview states in the tariff list**

Update the imports at the top of `src/features/charging-plans/components/TariffList.tsx`:

```ts
import type { ChargingPlan } from '../../../infra/db';
import type { LogicalTariffUpcomingVisibility } from '../model/logicalTariffs';
```

Add a small helper below `CurrentPricingRows`:

```ts
function formatUpcomingPreviewCopy(upcomingVisibility: Extract<LogicalTariffUpcomingVisibility, { kind: 'preview' }>): string {
  return upcomingVisibility.changes
    .map((change) => `${change.label} ${formatCurrency(change.valueCents)}`)
    .join(' · ')
}
```

Replace the current non-promo badge rendering inside the card header:

```tsx
                {logicalTariff.badge?.kind === 'promo' && (
                  <p className="text-sm font-medium text-primary">{logicalTariff.badge.label}</p>
                )}
```

Then render the indicator or preview immediately below `CurrentPricingRows`:

```tsx
            {logicalTariff.upcomingVisibility.kind === 'indicator' && (
              <p className="w-fit rounded-full bg-accent/10 px-3 py-2 text-xs font-semibold tabular-nums text-accent">
                {logicalTariff.upcomingVisibility.label}
              </p>
            )}

            {logicalTariff.upcomingVisibility.kind === 'preview' && (
              <div className="space-y-3">
                <div className="h-px bg-secondary/20" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold tabular-nums text-secondary">
                    {logicalTariff.upcomingVisibility.label}
                  </p>
                  {logicalTariff.upcomingVisibility.changes.length > 0 && (
                    <p className="text-sm tabular-nums text-primary">
                      {formatUpcomingPreviewCopy(logicalTariff.upcomingVisibility)}
                    </p>
                  )}
                </div>
              </div>
            )}
```

Keep the existing history button and card actions unchanged in this task.

- [ ] **Step 4: Run the tariff list test file and verify it passes**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx
```

Expected: PASS with the indicator, preview, and hidden-state tests green while the existing action and history tests remain intact.

- [ ] **Step 5: Commit the tariff list task**

```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx
git commit -m "feat(tariffs): render contextual upcoming version cards"
```

### Task 3: Regression Verification

**Files:**
- Modify: none
- Verify: `src/features/charging-plans/model/logicalTariffs.ts`
- Verify: `src/features/charging-plans/components/TariffList.tsx`
- Verify: `src/features/charging-plans/model/logicalTariffs.test.ts`
- Verify: `src/features/charging-plans/components/TariffList.test.tsx`

- [ ] **Step 1: Run the focused tariff visibility tests together**

Run:

```bash
npm run test -- --run src/features/charging-plans/model/logicalTariffs.test.ts src/features/charging-plans/components/TariffList.test.tsx
```

Expected: PASS with both files green.

- [ ] **Step 2: Run lint to catch type or JSX regressions**

Run:

```bash
npm run lint
```

Expected: PASS with no new lint violations in charging-plans files.

- [ ] **Step 3: Run the full required verification command from repository guidance**

Run:

```bash
npm run lint && npm run test -- --run && npm run build
```

Expected: PASS for lint, all Vitest suites, and the Vite production build.

- [ ] **Step 4: Commit the verification checkpoint if needed**

```bash
git status --short
```

Expected: no output if the previous task commits were clean. If verification fixes were required, commit them with:

```bash
git add src/features/charging-plans/model/logicalTariffs.ts src/features/charging-plans/model/logicalTariffs.test.ts src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx
git commit -m "test(tariffs): verify upcoming visibility refactor"
```
