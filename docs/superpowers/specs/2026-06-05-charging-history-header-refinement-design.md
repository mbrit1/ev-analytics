# Charging History Header Refinement Design

## Context

The charging history view already groups sessions by month and keeps the
sidebar navigation label as `Sessions`. The next change is a presentation-only
refinement to make the page hierarchy calmer and more clearly separated from
analytics-style summaries.

This work must stay within the existing Design Master system. Use the current
tokens, typography roles, spacing rhythm, numeric formatting helpers, and
responsive behavior patterns already present in the app. Do not introduce a new
font treatment, new color system, or new visual language.

## Goals

- Rename the page title from `Sessions` to `Charging History`.
- Remove any subtitle, helper copy, or page-level summary stats from the
  non-empty history view.
- Reduce vertical space between the page title and the first month group.
- Change each month header to a compact two-line stack.
- Remove the session count from month headers.
- Keep month summaries limited to total energy and total cost.
- Show energy first and cost second in the summary line.
- Use the same stacked month-header structure on desktop and mobile.

## Non-Goals

- Changes to the empty state copy or empty state layout.
- Changes to session cards.
- Changes to grouping logic, sorting logic, or month-total calculations.
- Changes to sidebar navigation labels.
- New analytics summaries, charts, or dashboard-style metrics.
- New typography scales, tokens, or custom visual exceptions.

## Approved Approach

Keep the change local to
`src/features/charging-sessions/components/ChargingHistory.tsx` and update the
existing test coverage in
`src/features/charging-sessions/components/ChargingHistory.test.tsx`.

Do not introduce a separate month-header component for this refinement. The
current screen is small enough that the existing inline structure remains the
clearest implementation. Do not move summary-string construction into the model
layer; formatting order and presentation belong in the UI.

## UI Structure

The non-empty page structure should read as:

```text
Charging History

May 2026
255,59 kWh · 105,23 €

[Session Cards]
```

Rules:

- The page title is `Charging History`.
- There is no subtitle beneath the page title.
- There are no page-level summary statistics beneath the page title.
- The sidebar label remains `Sessions`.
- The first month group should sit closer to the page title than it does today.

## Monthly Header Design

Each month header becomes a compact two-line grouped unit:

```text
May 2026
255,59 kWh · 105,23 €
```

Rules:

- Remove the session count entirely.
- Keep only total energy and total cost.
- Render energy first and cost second.
- Keep the month title as the primary line.
- Keep the summary line as the secondary line with lower visual weight.
- Keep the two lines visually tight so they read as one header unit rather than
  two separate blocks.
- Keep the existing localized month label output.
- Keep existing number formatting helpers and locale rules.
- Keep `tabular-nums` on the summary line.

## Responsive Behavior

The month header remains stacked on all breakpoints. Do not switch to a
split-row desktop layout for the month title and summary.

Mobile-specific rules:

- Keep the vertical gap between the month title and summary very small.
- Avoid large margins that make the header feel detached.
- Avoid summary wrapping unless space makes it unavoidable.
- Keep the month header visually quieter than the session cards beneath it.

## Implementation Notes

Implementation is presentation-only:

- update title styling and spacing in `ChargingHistory.tsx`,
- replace the responsive month-header row with a compact stacked block,
- remove the session-count text,
- reorder the summary text to `kWh` then `€`.

Do not modify:

- `groupSessionsByMonth`,
- `useSessions`,
- session services,
- shared numeric formatters,
- navigation components.

## Testing

Update
`src/features/charging-sessions/components/ChargingHistory.test.tsx` to verify:

- the page still renders `Charging History`,
- month labels still render correctly,
- month summaries render as `kWh · €`,
- session count text is no longer shown in the month header,
- existing session cards remain visible.

No new model or service tests are required because behavior and calculations are
unchanged.

## Risks and Guardrails

Primary risk is accidental copy or spacing regression in the history UI.

Guardrails:

- keep the change local to the history component and its UI test,
- preserve existing formatters instead of reimplementing number formatting,
- preserve the current empty-state behavior unchanged,
- follow the design governance checklist with no new token or typography
  deviations.
