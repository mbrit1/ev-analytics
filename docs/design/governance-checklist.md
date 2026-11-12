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
Use existing slab and typography tokens, keep metric weights consistent, and stack
values when available width is insufficient.

The Billing providers slab is an Analytics-local exception: it pairs prominent
selected-period spend with secondary billed energy, then a proportional energy
bar and a labelled provider list. It remains visible for short periods and sits
before lifetime Overall Price. Use recorded billing snapshots, not current
provider names; preserve known energy subtotals with measured/total coverage,
label partial totals as known billed energy, explain when no positive known energy
prevents a provider distribution, show unavailable values explicitly, and
distinguish free spend. At bottom-dock widths show four named providers when
there are four, or three plus Others at five or more. At sidebar widths show five named providers, adding Others at six
or more. Others discloses its members without changing the bar. Use stable
identity-based colors across rank changes, neutral Others, and text labels so
color is not the sole cue. Hide the bar for a single group or no positive known
energy. Stack energy beneath the name on mobile; align energy and spend in
separate columns on desktop. Keep the disclosure keyboard-operable with visible
focus and a 44px target, including when the layout changes while expanded.
This treatment improves scanning of period spend and energy on narrow screens;
it is a local exception, not a shared chart or grouping rule.

The Analytics monthly chart is a local example, not a shared chart primitive.
It uses a labelled native radio group for Spending, Energy and Price/kWh.
Spending is the default; retain the chosen mode across a temporary 7 Days or
30 Days selection, where the chart and selector are hidden. Calendar Month
shows six months of context ending in the selected month; 3 Months and Year use
clipped local-calendar monthly buckets, including up to four and thirteen
buckets respectively. Keep summary and lifetime scopes separate from chart
context, and show the wider Calendar Month dates when applicable.

Place the metric-specific heading and Info button on one row, followed by the
left-aligned segmented selector, date-range context and selected-month
explanation when applicable. The selector has one rounded, padded container,
three equal segments in a horizontal row, and minimum 44px targets. It fills
the available mobile width and is capped at 420px from the desktop `md`
breakpoint. Use the environment and primary/secondary typography tokens where
applicable: the light container resolves to `#F5F5F7`, with a `#1D1D1F`
active segment, white active text and `#1D1D1F` inactive text. The dark
container resolves to `#000000`, with a white active segment, `#1D1D1F` active
text and `#8E8E93` inactive text. Preserve native single-selection semantics,
arrow-key navigation, the `#007AFF` focus accent and reduced-motion behavior.

Use vertical bars for the additive monthly Spending and Energy totals, sharing
bar geometry, and independent dots for the weighted Price/kWh rate. Use the
existing slab, accent and typography tokens, restrained grid lines and
metric-specific zero-based scales; do not connect, interpolate or accumulate
monthly values. Spending uses recorded session charges in EUR, excluding
subscription fees. Energy is provider-billed kWh, not battery-added energy:
show a known partial subtotal only with measured and total session counts, and
never turn missing or invalid measurements into zero. A free session with valid
billed energy can have an Energy bar. Price requires complete valid cost and
billed energy coverage; an incomplete rate is unavailable, while complete free
charging can yield a true zero price. Preserve the existing calculation
contracts and localized European formatting, including tabular numeric values.

For Calendar Month, identify the selected summary month with a softly rounded
accent background at approximately 7% opacity behind the grid and data, an
emphasized month/year label and the text explaining its relationship to the
summary. This tint is contextual, not an interactive button state. Keep the
independent inspected-month indicator and metric-specific tooltip; inspecting a
bucket must not change the summary month. Rolling presets without a selected
summary month have no persistent highlight.

The focusable plot supports pointer and touch inspection and dragging, visible
keyboard focus, arrow keys and Home/End; the scale gutter is outside the hit
area. Show the tooltip only during pointer, touch, focus or keyboard inspection,
and close it on Escape or blur. Keep month/year and the active metric first,
with covered days and status secondary. At widths that fit, show individual
labels for the six-month context; use sparse labels when necessary. Show every
plot-aligned label for up to four buckets, including a rolling 3 Months range
that spans four months. For denser Year charts use restrained first, middle and
last labels within the plot column. Keep partial-month asterisks, MTD and year
labels legible across year boundaries, without shrinking or overlapping text.
All buckets remain inspectable and available in the equivalent textual table.

Keep the existing approximately 16px section rhythm, plot geometry and slab
padding. Coverage explanations precede the plot when needed; partial-month and
MTD notes and the collapsed-by-default View monthly values disclosure follow
it. Preserve distinct loading, query failure, empty, zero, partial and
unavailable states without stale values. Accessible headings, inspection text,
announcements and the table retain metric units, exact covered dates, session
counts and coverage or unavailability explanations. The disclosure has a
minimum 44px target and a named, focusable internal table scroller when needed.

The complete chart and disclosure, expanded table including its final row, and
Lifetime Overall Price slab must scroll above the fixed mobile dock. Internal
table scrolling must not cause document-level horizontal overflow; respect
safe-area spacing in iOS Safari/PWA. Browser checks have covered representative
mobile and desktop layouts in light and dark themes, keyboard inspection and
dock clearance. Confirmed 200% browser zoom, enlarged system text, physical
iOS Safari/PWA scrolling and safe-area behavior, and physical touch inspection
remain outstanding; browser evidence is not physical-device validation. The
chart has no essential animation. Record spoken screen-reader validation
separately. This remains an Analytics-local exception, not a global rule.
