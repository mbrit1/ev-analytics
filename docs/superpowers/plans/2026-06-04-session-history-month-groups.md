# Session History Month Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group charging-session history by month while preserving newest-first ordering, existing session cards, and the current empty state.

**Architecture:** Add one feature-local model utility, `groupSessionsByMonth`, that delegates ordering to `sortSessionsNewestFirst` and returns month-group metadata for the history UI. Keep the rendering change localized to `ChargingHistory`, and add a small shared `formatKwh` helper only because the month header needs the same low-noise numeric style already used elsewhere in the app.

**Tech Stack:** React 19, TypeScript, Dexie, Vitest, React Testing Library, Tailwind CSS, lucide-react.

---

## File Structure

- Create: `src/features/charging-sessions/model/groupSessionsByMonth.ts`
  - Owns month grouping, localized month labels, totals, and exported `SessionMonthGroup`.
- Create: `src/features/charging-sessions/model/groupSessionsByMonth.test.ts`
  - Verifies grouping order, totals, missing values, non-mutation, and local month-boundary behavior.
- Create: `src/shared/lib/utils.test.ts`
  - Verifies the new kWh formatter keeps `de-DE` formatting with 0-2 decimals.
- Modify: `src/shared/lib/utils.ts`
  - Adds and exports a `formatKwh` helper.
- Modify: `src/shared/lib/index.ts`
  - Re-exports the shared formatter.
- Modify: `src/features/charging-sessions/model/types.ts`
  - Re-exports `groupSessionsByMonth` and `SessionMonthGroup`.
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
  - Swaps flat rendering for grouped month sections with a separator-style header.
- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`
  - Verifies grouped headers, stable totals, and preserved card rendering.
- Modify: `src/features/charging-sessions/index.ts`
  - Keeps feature exports aligned if direct feature import coverage is needed.

---

### Task 1: Add the shared kWh formatter

**Files:**
- Create: `src/shared/lib/utils.test.ts`
- Modify: `src/shared/lib/utils.ts`
- Modify: `src/shared/lib/index.ts`

- [ ] **Step 1: Write the failing formatter tests**

Create `src/shared/lib/utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatKwh } from './utils';

/**
 * Test suite for shared numeric formatting helpers.
 *
 * Verifies that kWh values use German locale formatting with up to two decimal
 * places and without forced trailing zeroes.
 */
describe('formatKwh', () => {
  it('formats whole numbers without decimal places', () => {
    // Arrange: Use a whole-number kWh value.
    const input = 103;

    // Act: Format the kWh value for UI display.
    const formatted = formatKwh(input);

    // Assert: Whole numbers remain compact.
    expect(formatted).toBe('103');
  });

  it('formats one decimal place when needed', () => {
    // Arrange: Use a single-decimal kWh value.
    const input = 103.4;

    // Act: Format the kWh value for UI display.
    const formatted = formatKwh(input);

    // Assert: German decimal formatting is preserved.
    expect(formatted).toBe('103,4');
  });

  it('caps output at two decimal places', () => {
    // Arrange: Use a value that needs rounding.
    const input = 103.456;

    // Act: Format the kWh value for UI display.
    const formatted = formatKwh(input);

    // Assert: Output is rounded to two decimal places.
    expect(formatted).toBe('103,46');
  });
});
```

- [ ] **Step 2: Run formatter tests to verify RED**

Run:

```bash
npm run test -- --run src/shared/lib/utils.test.ts
```

Expected: FAIL because `formatKwh` is not exported yet.

- [ ] **Step 3: Implement the formatter**

Update `src/shared/lib/utils.ts`:

```ts
/**
 * Converts a decimal string (potentially with comma) to integer cents.
 * Handles both "1.50" and "1,50".
 *
 * @param val - The decimal string value
 * @returns Integer cents
 */
export function parseDecimalToCents(val: string): number {
  if (!val) return 0;

  // Replace comma with dot for standard parsing
  const normalized = val.replace(',', '.');
  const parsed = parseFloat(normalized);

  if (isNaN(parsed)) return 0;

  // Multiply by 100 and round to handle floating point precision
  return Math.round(parsed * 100);
}

/**
 * Formats integer cents to a localized decimal string (with comma).
 *
 * @param cents - The integer cents
 * @returns Localized decimal string (e.g. "1,50")
 */
export function formatCentsToDecimal(cents: number): string {
  const decimal = cents / 100;
  return decimal.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats cents for currency display (e.g. "1,50 €").
 */
export function formatCurrency(cents: number): string {
  return `${formatCentsToDecimal(cents)} €`;
}

/**
 * Formats kWh values with German locale decimals and no forced trailing zeroes.
 */
export function formatKwh(kwh: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(kwh);
}
```

Update `src/shared/lib/index.ts`:

```ts
export * from './utils';
```

- [ ] **Step 4: Run formatter tests to verify GREEN**

Run:

```bash
npm run test -- --run src/shared/lib/utils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/shared/lib/utils.ts src/shared/lib/utils.test.ts src/shared/lib/index.ts
git commit -m "feat(shared): add kwh display formatter"
```

---

### Task 2: Add the month-grouping model utility

**Files:**
- Create: `src/features/charging-sessions/model/groupSessionsByMonth.test.ts`
- Create: `src/features/charging-sessions/model/groupSessionsByMonth.ts`
- Modify: `src/features/charging-sessions/model/types.ts`
- Modify: `src/features/charging-sessions/index.ts`

- [ ] **Step 1: Write the failing grouping tests**

Create `src/features/charging-sessions/model/groupSessionsByMonth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '../../../infra/db';
import { groupSessionsByMonth } from './groupSessionsByMonth';

/**
 * Test suite for month-grouped charging-session history.
 *
 * Verifies newest-first month grouping, per-month totals, local date handling,
 * and immutability of the original session input.
 */
describe('groupSessionsByMonth', () => {
  function buildSession(
    id: string,
    sessionTimestamp: string,
    createdAt: string,
    overrides: Partial<ChargingSession> = {}
  ): ChargingSession {
    return {
      id,
      user_id: 'user-1',
      session_timestamp: new Date(sessionTimestamp),
      provider_id: 'provider-1',
      provider_name_snapshot: 'Tesla',
      charging_plan_name_snapshot: 'Standard',
      charging_type: 'AC',
      kwh_billed: 12.5,
      total_cost: 5000,
      session_mode: 'plan',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'sel-1',
      price_snapshot: { label: 'Tesla Standard', kWhPrice: 40, sessionFee: 0 },
      pricing_context: 'standard',
      applied_price_per_kwh: 40,
      applied_ac_price_per_kwh: 40,
      applied_dc_price_per_kwh: 40,
      applied_roaming_ac_price_per_kwh: undefined,
      applied_roaming_dc_price_per_kwh: undefined,
      applied_monthly_base_fee: undefined,
      applied_session_fee: 0,
      created_at: new Date(createdAt),
      updated_at: new Date(createdAt),
      ...overrides,
    };
  }

  it('groups sessions by month with newest months first', () => {
    // Arrange: Mix sessions from three different months out of order.
    const sessions = [
      buildSession('may', '2026-05-18T10:00:00.000Z', '2026-05-18T10:05:00.000Z'),
      buildSession('june-early', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('april', '2026-04-12T10:00:00.000Z', '2026-04-12T10:05:00.000Z'),
      buildSession('june-late', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
    ];

    // Act: Group the sessions for history rendering.
    const groups = groupSessionsByMonth(sessions);

    // Assert: Groups are ordered from newest month to oldest.
    expect(groups.map((group) => group.label)).toEqual([
      'Juni 2026',
      'Mai 2026',
      'April 2026',
    ]);
    expect(groups.map((group) => group.monthKey)).toEqual(['2026-06', '2026-05', '2026-04']);
  });

  it('keeps newest sessions first within a month', () => {
    // Arrange: Provide one month in the wrong order.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('session-3', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
      buildSession('session-2', '2026-06-02T10:00:00.000Z', '2026-06-02T10:05:00.000Z'),
    ];

    // Act: Group the sessions.
    const [juneGroup] = groupSessionsByMonth(sessions);

    // Assert: Sessions stay newest first inside the month.
    expect(juneGroup.sessions.map((session) => session.id)).toEqual([
      'session-3',
      'session-2',
      'session-1',
    ]);
  });

  it('calculates month totals from cost and billed kwh', () => {
    // Arrange: Use two sessions in the same month with different totals.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z', {
        total_cost: 2204,
        kwh_billed: 51.25,
      }),
      buildSession('session-2', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z', {
        total_cost: 2200,
        kwh_billed: 51.75,
      }),
    ];

    // Act: Group the sessions.
    const [juneGroup] = groupSessionsByMonth(sessions);

    // Assert: Group totals include both sessions.
    expect(juneGroup.count).toBe(2);
    expect(juneGroup.totalCostCents).toBe(4404);
    expect(juneGroup.totalKwh).toBe(103);
  });

  it('returns an empty array for empty input', () => {
    // Arrange: Use no sessions.
    const sessions: ChargingSession[] = [];

    // Act: Group the empty list.
    const groups = groupSessionsByMonth(sessions);

    // Assert: No groups are returned.
    expect(groups).toEqual([]);
  });

  it('treats missing totals defensively as zero', () => {
    // Arrange: Use malformed data with missing totals.
    const sessions = [
      buildSession('session-1', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z', {
        total_cost: undefined as unknown as number,
        kwh_billed: undefined as unknown as number,
      }),
    ];

    // Act: Group the malformed session.
    const [group] = groupSessionsByMonth(sessions);

    // Assert: Totals fall back to zero rather than crashing.
    expect(group.totalCostCents).toBe(0);
    expect(group.totalKwh).toBe(0);
    expect(group.count).toBe(1);
  });

  it('does not mutate the input array', () => {
    // Arrange: Capture original order before grouping.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('session-3', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
      buildSession('session-2', '2026-06-02T10:00:00.000Z', '2026-06-02T10:05:00.000Z'),
    ];
    const originalIds = sessions.map((session) => session.id);

    // Act: Group the sessions into a new structure.
    groupSessionsByMonth(sessions);

    // Assert: Source order remains untouched.
    expect(sessions.map((session) => session.id)).toEqual(originalIds);
  });

  it('groups by the locally displayed month rather than the utc month', () => {
    // Arrange: Use a boundary timestamp that crosses into June in Europe/Berlin.
    const sessions = [
      buildSession('boundary', '2026-05-31T22:30:00.000Z', '2026-05-31T22:35:00.000Z'),
    ];

    // Act: Group the boundary session.
    const [group] = groupSessionsByMonth(sessions);

    // Assert: The runtime local month is used for grouping.
    const expectedLabel = new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric',
    }).format(new Date('2026-05-31T22:30:00.000Z'));
    const expectedMonthKeyDate = new Date('2026-05-31T22:30:00.000Z');
    const expectedMonthKey = `${expectedMonthKeyDate.getFullYear()}-${String(
      expectedMonthKeyDate.getMonth() + 1
    ).padStart(2, '0')}`;

    expect(group.label).toBe(expectedLabel);
    expect(group.monthKey).toBe(expectedMonthKey);
  });
});
```

- [ ] **Step 2: Run grouping tests to verify RED**

Run:

```bash
npm run test -- --run src/features/charging-sessions/model/groupSessionsByMonth.test.ts
```

Expected: FAIL because `./groupSessionsByMonth` does not exist.

- [ ] **Step 3: Implement the grouping utility and exports**

Create `src/features/charging-sessions/model/groupSessionsByMonth.ts`:

```ts
import type { ChargingSession } from '../../../infra/db';
import { sortSessionsNewestFirst } from './sortSessionsNewestFirst';

export type SessionMonthGroup = {
  monthKey: string;
  label: string;
  sessions: ChargingSession[];
  count: number;
  totalCostCents: number;
  totalKwh: number;
};

const monthFormatter = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
});

function toDisplayDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date(0) : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }

  return new Date(0);
}

function toMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Groups charging sessions by locally displayed month while preserving the
 * shared newest-first history ordering.
 */
export function groupSessionsByMonth(sessions: ChargingSession[]): SessionMonthGroup[] {
  const sortedSessions = sortSessionsNewestFirst(sessions);
  const groups = new Map<string, SessionMonthGroup>();

  for (const session of sortedSessions) {
    const displayDate = toDisplayDate(session.session_timestamp);
    const monthKey = toMonthKey(displayDate);
    const existingGroup = groups.get(monthKey);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      existingGroup.count += 1;
      existingGroup.totalCostCents += session.total_cost ?? 0;
      existingGroup.totalKwh += session.kwh_billed ?? 0;
      continue;
    }

    groups.set(monthKey, {
      monthKey,
      label: monthFormatter.format(displayDate),
      sessions: [session],
      count: 1,
      totalCostCents: session.total_cost ?? 0,
      totalKwh: session.kwh_billed ?? 0,
    });
  }

  return Array.from(groups.values());
}
```

Update `src/features/charging-sessions/model/types.ts`:

```ts
import type { AdHocPricingSnapshot, ChargingSession } from '../../../infra/db';

type SessionPreparationBaseInput = Omit<
  ChargingSession,
  | 'id'
  | 'provider_name_snapshot'
  | 'charging_plan_name_snapshot'
  | 'total_cost'
  | 'applied_price_per_kwh'
  | 'applied_ac_price_per_kwh'
  | 'applied_dc_price_per_kwh'
  | 'applied_roaming_ac_price_per_kwh'
  | 'applied_roaming_dc_price_per_kwh'
  | 'applied_monthly_base_fee'
  | 'applied_session_fee'
  | 'created_at'
  | 'updated_at'
  | 'tariff_plan_id'
  | 'ad_hoc_pricing'
> & {
  tariff_plan_id?: string | null;
  ad_hoc_pricing?: AdHocPricingSnapshot | null;
};

export type ChargingPlanSessionPreparationInput = SessionPreparationBaseInput & {
  session_mode: 'plan';
  tariff_plan_id: string;
};

export type AdHocSessionPreparationInput = SessionPreparationBaseInput & {
  session_mode: 'ad_hoc';
  tariff_plan_id?: string | null;
  ad_hoc_pricing: AdHocPricingSnapshot;
};

export type SessionPreparationInput =
  | ChargingPlanSessionPreparationInput
  | AdHocSessionPreparationInput;

export type { ChargingSession };
export { sortSessionsNewestFirst } from './sortSessionsNewestFirst';
export type { SessionMonthGroup } from './groupSessionsByMonth';
export { groupSessionsByMonth } from './groupSessionsByMonth';
```

Update `src/features/charging-sessions/index.ts`:

```ts
export * from './components/ChargingHistory';
export * from './components/SessionForm';
export * from './hooks/useSessions';
export * from './services/sessionService';
export * from './model/types';
```

- [ ] **Step 4: Run grouping tests to verify GREEN**

Run:

```bash
npm run test -- --run src/features/charging-sessions/model/groupSessionsByMonth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/charging-sessions/model/groupSessionsByMonth.ts src/features/charging-sessions/model/groupSessionsByMonth.test.ts src/features/charging-sessions/model/types.ts src/features/charging-sessions/index.ts
git commit -m "feat(charging-sessions): add month grouping utility"
```

---

### Task 3: Render month-grouped history in the UI

**Files:**
- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`

- [ ] **Step 1: Expand the history UI test with grouped rendering assertions**

Update `src/features/charging-sessions/components/ChargingHistory.test.tsx`:

```ts
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChargingHistory } from './ChargingHistory';
import { db, type ChargingSession } from '../../../infra/db';
import { saveSession } from '../services/sessionService';

vi.mock('../../auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

/**
 * Test suite for the charging history UI.
 *
 * Ensures newly saved sessions appear without a full reload and render under
 * month-grouped history headings derived from the Dexie live-query results.
 */
describe('ChargingHistory', () => {
  beforeEach(async () => {
    // Arrange: Start each test from a clean IndexedDB state.
    await db.delete();
    await db.open();
  });

  it('renders a saved session after saveSession commits', async () => {
    // Arrange: Render the empty history first.
    render(<ChargingHistory />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const now = new Date('2026-05-30T10:00:00.000Z');
    const session: ChargingSession = {
      id: 'session-1',
      user_id: 'user-1',
      session_timestamp: now,
      provider_id: 'provider-1',
      provider_name_snapshot: 'Tesla',
      charging_plan_name_snapshot: 'Standard',
      charging_type: 'AC',
      kwh_billed: 12.5,
      total_cost: 5000,
      session_mode: 'plan',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'sel-1',
      price_snapshot: { label: 'Tesla Standard', kWhPrice: 40, sessionFee: 0 },
      pricing_context: 'standard',
      applied_price_per_kwh: 40,
      applied_ac_price_per_kwh: 40,
      applied_dc_price_per_kwh: 40,
      applied_roaming_ac_price_per_kwh: undefined,
      applied_roaming_dc_price_per_kwh: undefined,
      applied_monthly_base_fee: undefined,
      applied_session_fee: 0,
      created_at: now,
      updated_at: now,
    };

    // Act: Save a session after the component is already mounted.
    await saveSession(session);

    // Assert: The live query causes the history list to update.
    await waitFor(() => {
      expect(screen.getByText('Charging History')).toBeInTheDocument();
    });
    expect(screen.getByText('Tesla')).toBeInTheDocument();
  });

  it('renders sessions under month headings with stable summaries', async () => {
    // Arrange: Save sessions across two months, including a zero-total month entry.
    render(<ChargingHistory />);

    const maySession: ChargingSession = {
      id: 'session-may',
      user_id: 'user-1',
      session_timestamp: new Date('2026-05-18T10:00:00.000Z'),
      provider_id: 'provider-1',
      provider_name_snapshot: 'Tesla',
      charging_plan_name_snapshot: 'Standard',
      charging_type: 'AC',
      kwh_billed: 51.25,
      total_cost: 2204,
      session_mode: 'plan',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'sel-1',
      price_snapshot: { label: 'Tesla Standard', kWhPrice: 40, sessionFee: 0 },
      pricing_context: 'standard',
      applied_price_per_kwh: 40,
      applied_ac_price_per_kwh: 40,
      applied_dc_price_per_kwh: 40,
      applied_roaming_ac_price_per_kwh: undefined,
      applied_roaming_dc_price_per_kwh: undefined,
      applied_monthly_base_fee: undefined,
      applied_session_fee: 0,
      created_at: new Date('2026-05-18T10:05:00.000Z'),
      updated_at: new Date('2026-05-18T10:05:00.000Z'),
    };

    const juneSessionOne: ChargingSession = {
      ...maySession,
      id: 'session-june-1',
      session_timestamp: new Date('2026-06-01T10:00:00.000Z'),
      kwh_billed: 51.75,
      total_cost: 2200,
      created_at: new Date('2026-06-01T10:05:00.000Z'),
      updated_at: new Date('2026-06-01T10:05:00.000Z'),
    };

    const juneSessionTwo: ChargingSession = {
      ...maySession,
      id: 'session-june-2',
      session_timestamp: new Date('2026-06-03T10:00:00.000Z'),
      provider_name_snapshot: 'Ionity',
      total_cost: 0,
      kwh_billed: 0,
      created_at: new Date('2026-06-03T10:05:00.000Z'),
      updated_at: new Date('2026-06-03T10:05:00.000Z'),
    };

    await saveSession(maySession);
    await saveSession(juneSessionOne);
    await saveSession(juneSessionTwo);

    // Act: Wait for grouped history rendering.
    await waitFor(() => {
      expect(screen.getByText('Juni 2026')).toBeInTheDocument();
    });

    // Assert: Month labels, totals, and cards all remain visible.
    expect(screen.getByText('Mai 2026')).toBeInTheDocument();
    expect(screen.getByText('2 Sessions · 22,00 € · 51,75 kWh')).toBeInTheDocument();
    expect(screen.getByText('1 Session · 22,04 € · 51,25 kWh')).toBeInTheDocument();
    expect(screen.getByText('Tesla')).toBeInTheDocument();
    expect(screen.getByText('Ionity')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the history UI test to verify RED**

Run:

```bash
npm run test -- --run src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: FAIL because month headings and summaries are not rendered yet.

- [ ] **Step 3: Implement grouped history rendering**

Update `src/features/charging-sessions/components/ChargingHistory.tsx`:

```tsx
import React from 'react';
import { useSessions } from '../hooks/useSessions';
import { groupSessionsByMonth } from '../model/types';
import { formatCurrency, formatCentsToDecimal, formatKwh } from '../../../shared/lib';
import { Calendar, Zap, Info } from 'lucide-react';
import { Slab } from '../../../shared/ui';

/**
 * Displays locally saved charging sessions with their calculated cost and sync state.
 *
 * The history view reads from IndexedDB through {@link useSessions}, so newly
 * saved sessions appear immediately while the pending badge reflects whether an
 * outbox entry still needs remote sync.
 */
export const ChargingHistory: React.FC = () => {
  const { sessions, isLoading } = useSessions();
  const monthGroups = groupSessionsByMonth(sessions);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-slate-200 rounded-full"></div>
          <div className="h-4 w-32 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <Slab className="text-center p-12">
        <Info className="w-12 h-12 text-secondary/30 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-primary mb-2">No Sessions Yet</h2>
        <p className="text-secondary">Your charging history will appear here once you log your first session.</p>
      </Slab>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-secondary uppercase tracking-widest mb-4 px-2">
        Charging History
      </h2>
      <div className="space-y-6">
        {monthGroups.map((group) => (
          <section key={group.monthKey} className="space-y-4">
            <header className="px-1 pt-[18px] pb-[10px]">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className="text-base font-bold text-primary">
                  {group.label}
                </h3>
                <p className="text-sm font-medium text-secondary tabular-nums">
                  {group.count} {group.count === 1 ? 'Session' : 'Sessions'} · {formatCurrency(group.totalCostCents)} · {formatKwh(group.totalKwh)} kWh
                </p>
              </div>
            </header>

            <div className="space-y-4">
              {group.sessions.map((session) => (
                <Slab
                  key={session.id}
                  className="p-6"
                >
                  <div className="flex justify-between items-center">
                    <div className="space-y-1.5">
                      <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-secondary">
                        <Calendar className="w-3 h-3 mr-1.5" />
                        {new Date(session.session_timestamp).toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </div>
                      <h3 className="text-lg font-bold text-primary leading-tight">
                        {session.provider_name_snapshot || 'Unknown Provider'}
                      </h3>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm text-secondary font-medium">
                          {(session.session_mode === 'ad_hoc'
                            ? 'Ad-Hoc'
                            : (session.price_snapshot?.label ?? session.charging_plan_name_snapshot ?? 'Charging Plan'))} • {session.charging_type}
                        </p>
                        {session.session_mode === 'ad_hoc' && (() => {
                          const cpoName = session.ad_hoc_pricing?.cpoName?.trim();
                          const providerName = (session.provider_name_snapshot || '').trim().toLowerCase();
                          const shouldShowCpoName = cpoName != null && cpoName.toLowerCase() !== providerName;
                          const metadataParts = [shouldShowCpoName ? cpoName : null].filter(Boolean);

                          if (metadataParts.length === 0) {
                            return null;
                          }

                          return (
                            <p className="text-xs text-secondary/80 font-medium">
                              {metadataParts.join(' • ')}
                            </p>
                          );
                        })()}
                        {(session.start_soc_percentage != null || session.end_soc_percentage != null) && (
                          <p className="text-xs text-secondary/80 font-medium">
                            SoC {session.start_soc_percentage != null ? `${session.start_soc_percentage}%` : '—'} → {session.end_soc_percentage != null ? `${session.end_soc_percentage}%` : '—'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-4xl font-semibold text-primary tabular-nums tracking-tight">
                        {formatCurrency(session.total_cost)}
                      </p>
                      <div className="flex items-center justify-end text-lg font-medium text-secondary tabular-nums mt-1">
                        <Zap className="w-4 h-4 mr-1 text-accent" />
                        {formatCentsToDecimal(Math.round(session.kwh_billed * 100)).replace(',00', '')} <span className="text-sm ml-1">kWh</span>
                      </div>
                    </div>
                  </div>
                </Slab>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run the history UI test to verify GREEN**

Run:

```bash
npm run test -- --run src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/features/charging-sessions/components/ChargingHistory.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx
git commit -m "feat(charging-sessions): render month-grouped history"
```

---

### Task 4: Run full verification and close the branch cleanly

**Files:**
- Verify only: no new files

- [ ] **Step 1: Run the targeted tests together**

Run:

```bash
npm run test -- --run src/shared/lib/utils.test.ts src/features/charging-sessions/model/groupSessionsByMonth.test.ts src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: PASS for formatter, grouping, and history rendering coverage.

- [ ] **Step 2: Run lint for import boundaries and UI changes**

Run:

```bash
npm run lint
```

Expected: PASS with no import-boundary or JSX lint regressions.

- [ ] **Step 3: Run the full test suite once**

Run:

```bash
npm run test -- --run
```

Expected: PASS.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS with a successful type-check and Vite build.

- [ ] **Step 5: Commit any verification-driven fixes**

```bash
git add src/shared/lib/utils.ts src/shared/lib/utils.test.ts src/features/charging-sessions/model/groupSessionsByMonth.ts src/features/charging-sessions/model/groupSessionsByMonth.test.ts src/features/charging-sessions/model/types.ts src/features/charging-sessions/components/ChargingHistory.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx src/features/charging-sessions/index.ts
git commit -m "test(charging-sessions): finalize month-grouped history"
```

Only make this commit if verification exposes a real fix after Task 3. If no additional changes are needed, skip the commit and keep the branch at the earlier task commits.

---

## Implementation Notes

- Keep `groupSessionsByMonth` feature-local. Do not move session-specific grouping into `src/shared/lib/`.
- Use `session.session_timestamp` for both grouping semantics and visible date consistency.
- Preserve the existing `sessions.length === 0` empty-state gate.
- Always show month totals, including `0,00 €` and `0 kWh`.
- Keep the month header as a separator with compact padding, not a nested `Slab`.
- Preserve the existing session card UI unless a verification failure forces a narrowly scoped fix.
- Do not add sorting controls, filters, collapse behavior, or persistence.

## Self-Review Checklist

- Spec coverage:
  - Shared kWh formatting is covered in Task 1.
  - `groupSessionsByMonth` type, ordering, totals, and local-month behavior are covered in Task 2.
  - Grouped history rendering, stable zero-value summaries, and separator-style month headers are covered in Task 3.
  - Required lint, tests, and build verification are covered in Task 4.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” markers remain in tasks.
  - Each code-changing step includes concrete code or exact file content.
- Type consistency:
  - `SessionMonthGroup`, `groupSessionsByMonth`, and `formatKwh` names stay consistent across tasks.

