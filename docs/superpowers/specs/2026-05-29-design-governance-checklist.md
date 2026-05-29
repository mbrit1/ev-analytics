# Design Governance Checklist

Use this checklist for every UI-facing change. The default baseline is `2026-05-16-Design-System-Sandbox-v2.0.html`.

## 1) Token usage
- Surface/background uses sandbox roles (`bg-environment`, `surface-slab`) or their mapped Tailwind tokens (`bg-surface`, etc.).
- Accent interactions use `accent` token family, not ad-hoc hues.
- Typography roles are consistent: primary text for value/headline, secondary text for metadata/labels.

## 2) Control consistency
- Touch targets meet minimum 44px height for interactive controls.
- Primary actions follow shared emphasis treatment (accent fill, high contrast, strong affordance).
- Secondary actions follow shared contrast treatment (neutral fill or subtle border, not competing with primary).
- Selects and inputs in forms follow thin-underline paradigm with uppercase meta labels and consistent focus state.

## 3) Spacing and rhythm
- Form sections keep consistent vertical rhythm (section spacing + control spacing).
- Dense forms use structured section headings (small uppercase meta hierarchy).
- Action rows align with established slab/form patterns used in the app.

## 4) Tactile matrix behavior
- Matrix layout behavior is explicit at breakpoints and intentional for expected option counts.
- Matrix active/inactive visuals are consistent with baseline token states unless a deviation is documented.

## 5) Accessibility and semantics
- Inputs/selects have stable label relationships (`label` + `id`).
- Required fields expose visual indicator and semantic required attributes.
- Validation messages are connected via `aria-describedby` where applicable.

## 6) Deviation policy (required note in handoff)
- If a change intentionally differs from master, include:
- `what deviates`
- `why this improves UX for this screen`
- `decision`: `local exception` or `promote to master candidate`
