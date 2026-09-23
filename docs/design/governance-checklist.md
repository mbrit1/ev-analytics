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
- A screen with one primary create action uses the shared `PageActionSlab` structure: one `h1`, associated description, and one consumer-owned action.
- The surface remains in normal document flow rather than competing with persistent mobile navigation.
- The action has an accessible name and a minimum 44×44px target. Icon-only compact presentation may reveal its visible label from the `md` breakpoint.
- Tariffs and Sessions own their copy, visibility, callbacks, and focus-restoration state; the shared structure owns the common page-level hierarchy.

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
