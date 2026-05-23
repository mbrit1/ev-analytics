# Session Form Provider-Scoped Plan Selection Design

## Summary
Update the session entry flow so `Plan` selection depends on `Provider` selection.

Required behavior:
- `Plan` is not selectable until a provider is selected.
- `Plan` options contain only plans belonging to the selected provider.
- If the selected provider has exactly one plan, it is automatically selected.

This applies to the `pricing_source = chargingPlan` path only and should preserve existing ad-hoc pricing behavior.

## Problem Statement
Current behavior allows interacting with the `Plan` field before provider selection and can show a mixed plan list. This creates unnecessary user choices and weakens form guidance.

Desired UX is progressive:
1. Select provider.
2. Select among that provider’s plans.
3. Skip manual plan selection when only one provider plan exists.

## Scope
In scope:
- Session form behavior and UI state for provider/plan dependency.
- Form state synchronization when provider changes.
- Tests for disabled state, filtering, and auto-selection.

Out of scope:
- Changes to charging-plan CRUD, data model, sync, or Supabase schema.
- Changes to ad-hoc pricing form behavior.
- Multi-provider bulk workflows.

## Functional Requirements
1. **Provider-gated plan control**
- In charging-plan mode, `charging_plan_id` select is disabled while `provider_id` is empty.
- The field remains visible (for discoverability) but non-interactive.

2. **Provider-scoped options**
- Once a provider is selected, plan options include only `chargingPlans` where `plan.provider_id === selectedProviderId`.
- Placeholder option (`Select Plan`) remains available when there are multiple matching plans.

3. **Single-plan auto-selection**
- If selected provider has exactly one matching plan, set `charging_plan_id` to that plan automatically.
- If provider changes from a valid plan to a different provider:
  - clear `charging_plan_id` when multiple/no options exist,
  - auto-assign when exactly one option exists.

4. **Stale selection handling**
- If currently selected plan is not valid for the newly selected provider, reset/reassign per above rules.

5. **Edit-mode compatibility**
- Existing sessions with valid provider+plan should render unchanged.
- Legacy prefilled `tariff_id` mapping should continue to work when valid for the provider.

## Non-Functional Requirements
- Keep logic inside `SessionForm` with local derived state/effects.
- No extra network/database calls.
- Preserve current accessibility semantics (`label`/`id`, native `disabled` behavior).
- Keep implementation aligned with feature boundaries (`charging-sessions` using `charging-plans` public hooks only).

## Proposed Implementation
Primary file:
- `src/features/charging-sessions/components/SessionForm.tsx`

Approach:
- Derive `providerPlans` from `chargingPlans` + `selectedProviderId`.
- Add `react-hook-form` helpers (`setValue`, `getValues`) and a synchronization effect:
  - empty provider => clear plan,
  - invalid existing plan for selected provider => clear or auto-select,
  - one provider plan => auto-select.
- Update plan `<select>` to:
  - `disabled={!selectedProviderId}`,
  - render options from `providerPlans` only.

## Test Strategy
Primary test file:
- `src/features/charging-sessions/components/SessionForm.test.tsx`

Add/adjust tests to verify:
- plan select disabled before provider selection,
- plan select enabled after provider selection,
- options filtered to selected provider,
- single-plan provider auto-selects plan,
- provider change invalidates stale selection correctly.

Keep existing tests for ad-hoc and submission behavior passing.

## Verification
Required commands:
- `npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx`
- `npm run lint`
- `npm run test -- --run`
- `npm run build`

Manual check in browser (`http://localhost:5173/`):
- Plan disabled initially.
- Selecting provider with multiple plans shows only those plans and no forced selection.
- Selecting provider with one plan auto-selects it.
- Switching provider updates plan selection according to rules.

## Risks / Notes
- Auto-selection may mark field dirty in edit mode; we should set form flags intentionally to avoid confusing unsaved-change signals.
- If provider/plan lists refresh while form is open, synchronization must not oscillate or overwrite valid user choices.
- UX copy for disabled state can be improved later (e.g., helper text "Select provider first") but is not required for this change.
