# Design Governance Checklist

Use this checklist for every UI-facing change. The default baseline is
[`design-system-baseline.html`](./design-system-baseline.html).

## 1) Token usage
- Surface/background uses sandbox roles (`bg-environment`, `surface-slab`) or their mapped Tailwind tokens (`bg-surface`, etc.).
- Accent interactions use `accent` token family, not ad-hoc hues.
- Typography roles are consistent: primary text for value/headline, secondary text for metadata/labels.

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
Verify that the complete final card can scroll above the fixed bottom dock. Use existing slab and typography tokens,
keep metric weights consistent, and stack values when available width is insufficient.

The Analytics Session spending chart is headed Session spending and uses a
feature-local native Info disclosure for its explanation. It uses existing slab
and color tokens, discrete monthly accent bars, restrained grid lines, readable
month/year labels and a zero-based EUR axis with a few rounded, evenly spaced
ticks. Calendar Month, 7 Days, and 30 Days use three-month chart context ending
with the selection; label the chart's wider range and highlight the summary month
independently of the inspected month. 3 Months/Year use clipped rolling monthly
buckets, including up to thirteen months. Keep chart context separate from
summary scope, including for the shorter 7 Days/30 Days summaries.

The SVG plot is the touch selection area and supports dragging, visible keyboard
focus, arrow keys and Home/End; the adjacent EUR label gutter is outside the hit
area. Show the tooltip only during pointer, touch, focus or keyboard inspection,
and close it on Escape or blur. Keep its month/year and spend first, with covered
days and status secondary. At narrow widths, put sparse month labels in a
full-width row below the shared axis and plot so enlarged text stays readable.
Preserve inspectable empty/free/unavailable positions without inventing positive
spending bars. Keep the exact chart date range and context quiet beneath the
heading when chart bounds differ from the summary; its accessible heading and
table retain the exact covered dates. Mark
partial boundary months with an asterisk and the current month with MTD, avoiding duplicate markers
on the current label; explain only applicable abbreviations beneath the plot.
Keep month/year and spending primary in the two-level tooltip, with covered days
and status secondary. Retain exact covered dates and partial/current status in
accessible inspection text and the table; mark invalid recorded costs as
unavailable. Preserve distinct loading, query failure, empty-range and recorded-free states.

Keep View monthly values collapsed by default and visually quiet, with visible
focus and a minimum 44px target. Its complete textual monthly values must match
the accessible inspection text and announcements, including dates, status, counts and
unavailable explanations. Use a named, focusable internal table scroller when
necessary; verify six- and thirteen-bucket charts and expanded values at 320px,
wider mobile and desktop widths, dark theme and enlarged text. The chart has no
essential animation. Record Browser evidence separately from physical Safari/PWA
and spoken screen-reader validation. This remains a local exception, not a new
shared chart primitive or master design-system rule.
