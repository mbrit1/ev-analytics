# Design Governance Checklist

Use this checklist for every UI-facing change. The default baseline is
[`design-system-baseline.html`](./design-system-baseline.html).

## 1) Token usage
- Surface/background uses sandbox roles (`bg-environment`, `surface-slab`) or their mapped Tailwind tokens (`bg-surface`, etc.).
- Accent interactions use `accent` token family, not ad-hoc hues.
- Typography roles are consistent: primary text for value/headline, secondary text for metadata/labels.
- Use `text-slab-secondary` for secondary labels and notes on `bg-surface`. Maintain at least 4.5:1 for small text. The shared pair is `#6E6E73` on `#FFFFFF` in light mode (5.07:1) and `#8E8E93` on `#1C1C1E` in dark mode (5.22:1).

## 2) Control consistency
- Touch targets meet minimum 44px height for interactive controls.
- Primary actions follow shared emphasis treatment (accent fill, high contrast, strong affordance).
- Secondary actions follow shared contrast treatment (neutral fill or subtle border, not competing with primary).
- Inputs in forms follow the thin-underline paradigm with uppercase meta labels and consistent focus state. The Tariffs provider control is a documented local tactile-matrix exception.

## 3) Shared page-action surface
- A screen with one primary create action uses the shared `PageActionSlab`: it owns the `h1`, associated description, and standard responsive button presentation, accessible name, and optional live button ref. A consumer may instead provide a custom action node.
- The surface remains in normal document flow rather than competing with persistent mobile navigation.
- The action has an accessible name and a minimum 44×44px target. Icon-only compact presentation may reveal its visible label from the `md` breakpoint.
- Tariffs and Sessions own action copy, visibility, callback behavior, and focus-restoration state; shared UI owns only the standard presentation and page-level hierarchy.

## 4) Spacing and rhythm
- Form sections keep consistent vertical rhythm (section spacing + control spacing).
- Dense forms use structured section headings (small uppercase meta hierarchy).
- Action rows align with established slab/form patterns used in the app.

## 5) Interaction and motion
- Hover-only feedback is gated by both `(hover: hover)` and `(pointer: fine)`; touch feedback uses active state rather than sticky hover.
- Every interactive control has a visible `:focus-visible` treatment that is not removed without an equivalent replacement.
- Motion is decorative rather than required to understand state. `prefers-reduced-motion` disables animation and nonessential transitions while preserving static feedback.
- When a temporary form or overlay closes, focus returns to the newly rendered live trigger when continuity requires it. Do not target a stale node, `<body>`, or an unrelated fallback control.

## 6) Tactile matrix behavior
- Matrix layout behavior is explicit at breakpoints and intentional for expected option counts.
- Matrix active/inactive visuals are consistent with baseline token states unless a deviation is documented.
- Tariffs provider selection uses the shared `TactileMatrix` with stable provider IDs, pointer/keyboard selection, required validation, and disabled edit-mode options.

## 7) Accessibility, status, and semantics
- Inputs/selects have stable label relationships (`label` + `id`).
- Required fields expose visual indicator and semantic required attributes.
- Validation messages are connected via `aria-describedby` where applicable.
- Page and grouped-content headings form a meaningful hierarchy without skipping levels.
- Interactive cards use one native interactive root with a concise, distinguishable accessible name and no nested controls.
- Blocking loading exposes one concise polite status; decorative skeletons are hidden from assistive technology.
- Cached-content refresh, blocking failure, and settled-empty states remain distinguishable and do not announce invented data.
- Metric zero and unavailable states remain distinct: show zero only when supported by loaded data, and explain unavailable values in text.
- Partial measurement coverage is disclosed beside the affected value; do not present a known subtotal as a complete total. Metric-specific calculation rules stay in the owning specification.
- Suppress stale metric values during blocking loading or query failure. Keep these states distinct from loaded-empty data.
- The period selector shows one quiet inclusive date range and progress line with an accessible description on its control group. Desktop places the range beside the selected month or preset label, wrapping it beneath the selection before squeezing 44px controls; mobile keeps it beneath the controls. The visible summary title stays concise while its accessible name retains the selected period, exact dates and progress state. Lifetime metrics remain separately labelled so the selected period does not imply a different scope.
- Numeric alignment uses `tabular-nums` where it materially improves scanning, not as a blanket layout rule.

## 8) Deviation policy (required note in handoff)
- If a change intentionally differs from master, include:
- `what deviates`
- `why this improves UX for this screen`
- `decision`: `local exception` or `promote to master candidate`

The page-action surface is promoted to the master baseline after independent
Tariffs and Sessions adoption. Tariffs retains its provider-matrix usage,
`EntitySlab` navigation, and responsive action-overlay geometry as local
exceptions. Sessions retains chronological grouping and native whole-card
editing as a local exception; it does not inherit Tariffs navigation or actions.

Analytics retains its grouped summary and separately labelled lifetime surface as
a local example. Its 1024px column breakpoint accounts for app-sidebar space;
it is not a shared layout rule. Desktop uses month-first navigation with a month/year
chooser and a secondary Other ranges popover; preset options are hidden by default.
Show month arrows and the month chooser only in Calendar Month mode. Rolling ranges
show their active label without stepping controls; Other ranges can restore the remembered month.
Popovers support keyboard focus, Escape dismissal, outside-interaction dismissal,
and focus return after selection. Keep the complete month/year label readable at
sidebar widths and all controls at least 44px. Mobile uses month-first controls with
an overflow-triggered Analysis period bottom sheet offering Calendar Month and all
four rolling presets. Mark the active option with a checkmark; month arrows and the
month/year sheet are available only in calendar mode. Preserve modal background locking,
focus containment, Escape/backdrop/Cancel dismissal, safe-area padding and focus return.
Use existing slab and typography tokens, keep metric weights consistent, and stack
values when available width is insufficient.

The Billing providers slab is an Analytics-local exception. Show the
selected-period billed kWh beside the distribution label above the proportional
bar. Emphasize session spend in each provider row. It remains visible for short periods and sits
before lifetime Overall Price. Use recorded billing snapshots, not current
provider names; preserve known energy subtotals with measured/total coverage,
label partial totals as known billed energy, explain when no positive known energy
prevents a provider distribution, show unavailable values explicitly, and
distinguish free spend. At bottom-dock widths show up to four named providers
and add Others at five or more. At sidebar widths show up to five named providers
and add Others at six or more. Both layouts keep the bar grouped by the collapsed
list. Directly above the bar, show “Billed energy by provider” for complete coverage or “Known billed
energy by provider” for partial coverage, matching the accessible description.
Map the normalized billing snapshot name to a fixed color independently of
period, rank, other providers, layout and theme. Use the Analytics-local palette:
green `#009E73`, blue `#007AFF`, amber `#E69F00`, purple `#986CC7`,
vermilion `#D55E00`, teal `#007C91`, indigo `#5B5FC7`, olive `#6F7F28`,
and brown `#8F694A`; reserve `#8E8E93` for the synthetic Others aggregate.
These are categorical colors, not global accent tokens. Collisions are allowed:
keep a provider's segment and list indicator the same color, separate adjacent
segments with a 1px surface-colored divider, and retain text labels and values
so color is not the sole cue. Hide the bar for a single group or no positive known
energy. Stack energy beneath the name on mobile; align energy and spend in
separate columns on desktop. Use the shared slab text role for secondary labels.

At bottom-dock widths, the full Others row opens the **Other billing providers**
bottom sheet with each member’s billed kWh and spend. Keep long lists scrollable
within the sheet, account for safe areas, lock the background, and contain focus
in the sheet. Support dismissal with Close, Escape, or the backdrop. Return
focus to Others on dismissal or to the provider list if the trigger disappears.
At sidebar widths, Others expands its member rows inline. Both controls use
visible keyboard focus and a 44px minimum target. Close the disclosure if the
layout or membership of Others changes.
This treatment improves scanning of period spend and energy on narrow screens;
it is a local exception, not a shared chart or grouping rule.

The Analytics period comparison is a local example. Use two compact vertical bars on
a shared zero baseline. Place formatted values above and previous and selected
period labels and inclusive dates below. Use neutral slab styling for the
previous bar and the accent token for the selected bar. The text serves as
the equivalent of the static graphic; the bars do not need focus or tooltips.
Keep comparison deltas in the Summary.

Reuse the native Spending, Energy and Price/kWh radios with equal segments,
44px minimum targets, visible accent focus and arrow-key selection. Fill
available width on mobile and cap the selector at 420px at desktop widths.
Respect reduced motion and use shared typography and slab tokens. Keep the
values and exact ranges readable when dates wrap. Show an in-progress label
where applicable. Distinguish no sessions, valid zero, and unavailable values;
disclose measured and total sessions beside a known energy subtotal. Test
both themes and narrow widths, including clearance above the fixed dock.
