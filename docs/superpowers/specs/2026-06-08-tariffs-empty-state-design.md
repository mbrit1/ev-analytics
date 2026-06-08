# Tariffs Empty State Design

## Context

Issue [#48](https://github.com/mbrit1/ev-analytics/issues/48) requests a
Tariffs-screen empty state that matches the existing Sessions-screen pattern.
Today the Sessions screen already renders a centered `Slab` information card in
`src/features/charging-sessions/components/ChargingHistory.tsx` when there are
no saved sessions, while
`src/features/charging-plans/components/TariffList.tsx` leaves the content area
blank when `plans.length === 0`.

The goal is to remove that inconsistency without changing tariffs data flow,
form behavior, or the broader page layout.

## Goals

- Show a helpful empty-state information card on the Tariffs screen when there
  are no saved tariffs.
- Match the existing Sessions empty-state visual pattern as closely as possible.
- Keep the existing `Add Tariff` primary action visible while the form is
  closed.
- Remove the empty-state card automatically once at least one tariff exists.
- Add focused test coverage for the empty-state rendering behavior.

## Non-Goals

- Refactoring Sessions and Tariffs to share a new generic empty-state component.
- Changing tariff creation, editing, deletion, or loading behavior.
- Changing page-level layout, navigation labels, or action-button placement.
- Introducing new visual language, tokens, icons, or typography roles.
- Changing hook, service, model, or database behavior.

## Approved Approach

Keep the implementation local to
`src/features/charging-plans/components/TariffList.tsx` and update
`src/features/charging-plans/components/TariffList.test.tsx`.

Do not extract a shared empty-state abstraction for this issue. The repository
guidance prefers feature-local code before shared abstractions, and the request
is a narrowly scoped presentation parity fix.

## UI Behavior

When the Tariffs screen is active and the tariff form is closed:

- if `plans.length === 0`, render a centered `Slab` information card beneath
  the existing header row,
- if `plans.length > 0`, render the existing tariff cards exactly as today.

The empty-state card should mirror the Sessions pattern in structure and tone:

- `Info` icon,
- short headline,
- supporting copy,
- centered layout inside a `Slab`.

Approved copy:

- Headline: `No Tariffs Yet`
- Body: `Your saved tariffs will appear here once you add your first tariff.`

The existing `Add Tariff` button remains visible on desktop whenever the form is
closed, including the empty state. The empty-state card must not appear while
the create or edit form is open.

## Render Rules

The Tariffs screen should preserve the current high-level render sequence:

1. Keep the existing loading state unchanged when `isLoading` is true.
2. Keep rendering `TariffFormLoader` when `isFormVisible` is true.
3. When `isFormVisible` is false and `plans.length === 0`, render the empty
   state card.
4. When `plans.length > 0`, render the existing list of tariff cards unchanged.

This keeps the change easy to reason about and avoids side effects in tariff
form flows.

## Component Boundaries

No new shared UI primitive is needed for this change.

The implementation should reuse the same component language already present in
the app:

- `Slab` from `src/shared/ui`
- `Info` icon from `lucide-react`

The new branch should stay inside `TariffList.tsx` rather than moving empty
state logic into hooks, models, or shared infrastructure. This behavior is
presentation-only and belongs in the feature UI layer.

## Testing

Update `src/features/charging-plans/components/TariffList.test.tsx` with a
focused empty-state test surface.

Required coverage:

- renders `No Tariffs Yet` when `plans` is empty and the form is closed,
- renders the supporting copy in that same state,
- keeps the `Add Tariff` button visible in the empty state,
- does not render the empty-state card once at least one plan exists,
- does not render the empty-state card while the form is open.

No service, hook, or model tests need to change because the feature behavior is
limited to conditional UI rendering.

## Risks and Guardrails

Primary risk is drifting away from the Sessions empty-state pattern and creating
another small visual inconsistency.

Guardrails:

- keep the copy exactly aligned with issue `#48`,
- mirror the Sessions empty-state structure closely,
- avoid shared-component extraction in this issue,
- keep the change limited to the Tariffs component and its test file,
- preserve existing header and CTA behavior.

## Acceptance Criteria

- The Tariffs screen shows an informational empty-state card when
  `plans.length === 0` and the form is closed.
- The card uses the same component language as the Sessions empty state:
  `Slab`, centered layout, `Info` icon, and supporting text.
- The `Add Tariff` action remains available while the empty state is shown.
- The card disappears when a tariff exists.
- Focused test coverage verifies the empty-state behavior.
