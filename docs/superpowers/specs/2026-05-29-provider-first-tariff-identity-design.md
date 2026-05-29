# Provider-First Tariff Identity Design

## Summary
Rework tariff card identity so users can immediately see the provider for each tariff.

Required behavior:
- Tariff cards use **provider name** as the primary title.
- Tariff name becomes an **optional variant label** shown only when non-empty.
- The system allows **at most one unnamed tariff per provider**.

This design is intentionally limited to identity semantics for tariffs and form/data-model alignment that supports this identity.

## Problem Statement
Current tariff cards do not expose provider identity clearly. A generic subtitle (`Tariff`) is redundant and does not help users distinguish records by provider.

We need a provider-first model that:
1. makes provider visible in list UI,
2. keeps tariff naming flexible when variants matter,
3. prevents ambiguous unnamed variants under one provider.

## Scope
In scope:
- Tariff card header identity behavior.
- Tariff form requirements for provider-first semantics.
- Application-level invariant for unnamed variants per provider.
- Validation/error behavior for violating that invariant.

Out of scope:
- Action button styling/layout changes.
- Optional price/fee row visibility logic.
- Provider CRUD or provider schema changes.
- Sync protocol/schema updates in Supabase.

## Functional Requirements
1. **Provider-first card title**
- Each tariff card title renders the provider name resolved from `provider_id`.
- If provider resolution fails, render `Unknown provider` as defensive fallback.

2. **Optional variant subtitle**
- If `plan_name` is non-empty after trimming, show it as the secondary subtitle.
- If `plan_name` is empty/blank, do not render a subtitle.
- Do not render a static `Tariff` subtitle.

3. **Tariff name optional in form**
- `Tariff Name` is optional in Add/Edit Tariff.
- `provider_id` remains required.
- On submit, normalize `plan_name` with trim; blank normalizes to empty string.

4. **Single unnamed variant invariant**
- Per provider, only one active tariff may have blank `plan_name`.
- Creating or editing a tariff to blank `plan_name` must fail when another active unnamed tariff already exists for that provider.
- Named variants for the same provider remain allowed.
- Unnamed tariffs for different providers remain allowed.

5. **Validation feedback**
- When the invariant is violated, surface a clear user-facing message: `Only one unnamed tariff is allowed per provider`.
- Error appears in form submission flow without data loss in entered fields.

## Non-Functional Requirements
- Keep enforcement in existing application write path (no schema migration).
- Keep behavior offline-first and deterministic against local IndexedDB state.
- Preserve current import boundaries (`charging-plans` domain + shared/infra contracts).
- Keep accessibility intact (form labels and error messaging semantics).

## Proposed Implementation
Primary areas:
- `src/features/charging-plans/components/TariffList.tsx`
- `src/features/charging-plans/components/TariffForm.tsx`
- `src/features/charging-plans/services/chargingPlanService.ts`

Approach:
- In list rendering, resolve provider name from provider cache and render it as the card title.
- Render `plan_name` as optional subtitle only when trimmed value is non-empty.
- Update form schema and field copy so `plan_name` is optional.
- Normalize/trim `plan_name` before persistence.
- In save service, check for existing active unnamed tariff in same provider (excluding current record on edit); reject on conflict.
- Bubble service error to form-level message for user correction.

## Data Flow and Error Handling
1. User submits Add/Edit Tariff.
2. Form normalizes `plan_name` (`trim`).
3. Save path validates unnamed-variant constraint against local active tariffs for provider.
4. On success, tariff persists and list shows provider-first identity.
5. On failure, form displays invariant error and keeps user inputs.

## Test Strategy
Add/adjust tests to cover:
- Tariff list shows provider as title and hides static `Tariff` label.
- Variant subtitle appears only for non-empty `plan_name`.
- Form submits successfully with empty tariff name.
- Save path rejects second unnamed tariff for same provider.
- Save path allows named+unnamed for same provider and unnamed tariffs across providers.
- Form shows user-facing validation error for duplicate unnamed variant.

Primary test targets:
- `src/features/charging-plans/components/TariffList.test.tsx`
- `src/features/charging-plans/components/TariffForm.test.tsx`
- `src/features/charging-plans/services/chargingPlanService.test.ts`

## Verification
Required commands:
- `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`
- `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`
- `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`
- `npm run lint && npm run test -- --run && npm run build`

Manual browser checks (`http://localhost:5173/`):
- Card title clearly shows provider name.
- Card subtitle is absent for unnamed tariff and present only when tariff variant name exists.
- Attempting to create a second unnamed tariff for same provider shows blocking error.

## Risks / Notes
- `Unknown provider` fallback should be rare; if observed, it likely indicates data integrity issues in provider lifecycle.
- Invariant enforcement is app-layer only; concurrent multi-client conflicts are outside current single-user offline-first scope.
- Existing data with multiple unnamed tariffs under a provider (if any) must be handled by first-write validation behavior and user correction.
