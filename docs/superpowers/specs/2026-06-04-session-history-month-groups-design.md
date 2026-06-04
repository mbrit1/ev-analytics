# Session History Month Groups Design

## Context

The charging-session history already has a fixed newest-first ordering on the
current branch through `sortSessionsNewestFirst(sessions)`. The next change is
to keep that ordering and display the history grouped by month. This is a
presentation and model-utility change only. It must not introduce sorting or
grouping controls, persistence, database migrations, Dexie migrations, or
Supabase changes.

The implementation stays on branch
`feat/session-history-newest-first-and-month-groups`, which now covers both the
newest-first history ordering and monthly grouping work.

## Goals

- Show charging-session history grouped automatically by month.
- Keep newest months first.
- Keep sessions inside each month newest first.
- Render a minimal month header with label, count, total cost, and total kWh.
- Preserve the existing empty state and existing session card presentation.
- Avoid mutating the original session array or session objects.
- Keep the change feature-local except for a small shared kWh formatter if
  needed.

## Non-Goals

- Sort selection UI.
- Grouping on/off UI.
- Collapse or expand behavior.
- Analytics charts or month dashboards.
- Database, Dexie, or Supabase schema changes.
- Persisted display options.
- Broader history-card redesigns.

## Architecture

Add a feature-local utility:

```ts
groupSessionsByMonth(sessions: ChargingSession[]): SessionMonthGroup[]
```

The utility belongs in:

```text
src/features/charging-sessions/model/groupSessionsByMonth.ts
```

It will be exported through the charging-session model exports alongside
`sortSessionsNewestFirst`.

Use this type:

```ts
export type SessionMonthGroup = {
  monthKey: string;
  label: string;
  sessions: ChargingSession[];
  count: number;
  totalCostCents: number;
  totalKwh: number;
};
```

`monthKey` uses `YYYY-MM`, for example `2026-06`. `label` uses the localized
month and year, for example `Juni 2026`.

## Sorting and Grouping Rules

`groupSessionsByMonth` must call `sortSessionsNewestFirst(sessions)` internally
before grouping. This keeps the ordering source of truth in one place:

- newest months first,
- newest sessions inside each month first,
- deterministic tie handling,
- no duplicated sort logic.

Grouping uses `session.session_timestamp`, the same date field used by
`sortSessionsNewestFirst`. Month assignment must follow the same locally
formatted date users see in `ChargingHistory`, not the UTC month. Use `de-DE`
as the locale fallback because the existing history date and money formatting
already use German conventions.

The month key must be derived from local date parts:

```ts
const year = date.getFullYear();
const month = date.getMonth() + 1;
const monthKey = `${year}-${String(month).padStart(2, '0')}`;
```

The label must use `Intl.DateTimeFormat` with local month/year formatting:

```ts
new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
}).format(date)
```

Invalid dates must not crash the utility. They must follow the existing sort
fallback behavior by grouping under `new Date(0)`, which produces the local
fallback month key and label for the runtime timezone. `ChargingSession` already
requires `session_timestamp`, so this is defensive behavior for malformed input
rather than a normal user path.

## Month Totals

Each month group calculates:

- `count`: number of sessions in the month.
- `totalCostCents`: sum of `session.total_cost ?? 0`.
- `totalKwh`: sum of `session.kwh_billed ?? 0`.

Money stays in integer cents. The implementation must not create float money
amounts. Missing cost or kWh values are treated as `0`.

The UI always shows all totals, including zero values. Do not hide `0,00 €`,
`0 kWh`, or the session count.

## UI Design

`ChargingHistory` will change from rendering a flat sorted array to rendering
month groups:

```tsx
const monthGroups = groupSessionsByMonth(sessions);

monthGroups.map((group) => (
  <section key={group.monthKey}>
    <MonthHeader group={group} />
    {group.sessions.map((session) => (
      <SessionCard key={session.id} session={session} />
    ))}
  </section>
));
```

This is illustrative structure. The actual implementation should follow the
current `ChargingHistory` file shape, where the session card markup is inline
inside a `Slab`.

The existing empty state remains based on:

```ts
sessions.length === 0
```

The month header acts as a list separator, not as its own Floating Slab card.
Use compact spacing close to:

```css
padding: 18px 4px 10px;
```

Header content:

```text
Juni 2026
4 Sessions · 44,04 € · 103 kWh
```

Rules:

- no chevron,
- no collapse or expand affordance,
- no actions,
- no sort or filter controls,
- secondary typography for totals,
- `tabular-nums` for all numeric header values,
- existing session `Slab` cards stay visually unchanged.

Cost display uses the existing `formatCurrency(group.totalCostCents)`.

kWh display should match the calm existing history style:

```ts
new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(totalKwh)
```

Examples:

```text
103 kWh
103,4 kWh
103,45 kWh
```

If no suitable formatter already exists, add a small shared formatter in
`src/shared/lib/utils.ts`, because numeric kWh formatting is domain-neutral
enough and existing money formatters already live there.

## Tests

Add unit tests for `groupSessionsByMonth` next to the existing model tests:

```text
src/features/charging-sessions/model/groupSessionsByMonth.test.ts
```

The test file must include the repository-standard suite-level JSDoc above the
main `describe` and Arrange, Act, Assert comments inside test cases.

Cover:

- multiple months: `03.06.2026`, `18.05.2026`, `01.06.2026`,
  `12.04.2026` produces `Juni 2026`, `Mai 2026`, `April 2026`,
- order inside one month: `03.06.2026`, `02.06.2026`, `01.06.2026`,
- month totals for `count`, `totalCostCents`, and `totalKwh`,
- empty input returns `[]`,
- missing `total_cost` or `kwh_billed` values are treated as `0`,
- input array order is not mutated,
- local month-boundary behavior does not accidentally use UTC month grouping.

Extend `ChargingHistory.test.tsx` with focused UI coverage:

- grouped month labels render for sessions from at least two months,
- month summaries render count, cost, and kWh,
- existing session card content still appears,
- empty state remains unchanged for no sessions.

Avoid fragile pixel or exact class assertions unless they protect a required
behavior such as the presence of `tabular-nums` on the header summary.

## Acceptance Criteria

- Session history is automatically grouped by month.
- Newest months appear first.
- Sessions within each month remain newest first.
- Month headers show label, session count, total cost, and total kWh.
- Header totals are always displayed, including zero values.
- Header numeric values use tabular numbers.
- No additional controls are introduced.
- Original session data is not mutated.
- Unit and UI tests cover grouping and rendering behavior.
- No database, Dexie, Supabase, or schema changes are made.

## Verification

Before handoff, run:

```bash
npm run lint
npm run test -- --run
npm run build
```

Because this is a UI-visible change, include design-governance handoff notes.
The expected classification is no exception: the header is a local list
separator within the existing Floating Slab history rhythm, not a new component
pattern or screen-level deviation.

Suggested implementation commit message:

```text
feat(charging-sessions): group history by month
```
