# Shared App-Controlled Date Picker Design

## Context

The tariff edit/create form has a Safari-specific failure mode for the optional `Valid To` date. Existing open-ended tariffs can appear to show today's date when the user focuses the empty native date field, even though no end date was set. Prior quick fixes were rejected because removing the picker harmed the workflow, and retaining a visible native `type="date"` field still let Safari paint a misleading current-date UI.

The repo currently uses visible native date inputs in tariff, permanent price-change, and temporary promotion forms. The session form already wraps a hidden native date input behind an app-controlled visible trigger, but it still relies on browser-native picker rendering. The desired outcome is broader than a Safari patch: all visible date-picking UI should look and behave consistently across browsers.

## Goals

- Replace visible browser-controlled date pickers with a shared app-controlled picker pattern.
- Preserve the picker workflow for all date fields.
- Keep optional tariff `Valid To` open-ended unless the user actively chooses an end date.
- Show the optional empty state as `Open-ended` in the UI.
- Avoid implementation terms such as `null` in user-facing labels, buttons, helper text, and errors.
- Make the date picker visually consistent across Safari, Chrome, Firefox, and mobile browsers.
- Preserve existing UTC date parsing, formatting, storage, sync, and persistence contracts.

## Non-Goals

- No database schema changes.
- No sync schema or outbox contract changes.
- No Supabase/RLS/auth posture changes.
- No tariff overlap or versioning behavior changes.
- No session timestamp storage behavior changes.
- No new dependency unless the implementation plan explicitly justifies one with bundle and maintenance trade-offs.

## Approved Approach

Create a shared date picker component in `src/shared/ui` and migrate every visible date-picker occurrence in one focused PR.

The shared component must remain domain-agnostic. It can know about date strings, labels, required state, optional empty state, picker constraints, and accessible error display. It must not know about tariffs, charging sessions, Supabase, Dexie, outbox sync, or charging-plan business rules.

The implementation should cover:

- tariff `Valid From`
- tariff optional `Valid To`
- permanent price change `Effective From`
- temporary promotion `Promo Start`
- temporary promotion `Promo End`
- session `Date`

The component should replace visible native date controls. Required fields and optional fields share the same picker surface, with optional behavior enabled through explicit props.

## Alternatives Considered

### Feature-local optional picker for tariff `Valid To`

This would be the smallest direct fix for the Safari bug. It was rejected for v1 because picker behavior should be consistent everywhere once the app departs from native rendering.

### App-controlled trigger over hidden native date input

This matches the current session form pattern and would be lighter than a custom picker. It was rejected as the primary direction because it still depends on browser/OS-controlled date rendering, which is the source of the Safari ambiguity.

### Shared app-controlled picker

This is the approved direction. It has the largest first implementation surface, but it produces one consistent interaction model and avoids future one-off date picker patches.

## Interaction Model

Every migrated date field renders as a thin-underlined control that matches the existing form visual language. It includes the field label, a readable formatted date value, a calendar affordance, optional required indicator, and accessible error messaging.

Opening the control shows an app-controlled calendar-grid picker with month navigation and day buttons. The visible picker UI must not rely on the browser's native date rendering. Native date inputs may only be used if they are not the user-visible picker experience and do not determine the optional empty-state display.

Picker selections are staged until the user confirms them. Required fields always resolve to a concrete `YYYY-MM-DD` value before submit. If the field is invalid or missing, the owning form's existing validation displays the error through the shared control.

Optional fields can be empty. For tariff `Valid To`, the empty visible value is `Open-ended`. Opening the picker from `Open-ended` must not silently select or commit today. A date is committed only after the user actively selects and confirms a date. Clearing the field returns it to `Open-ended`.

Expected optional `Valid To` flow:

1. Existing open-ended tariff opens with `Valid To` displaying `Open-ended`.
2. User opens the picker.
3. Picker opens with a sensible focus date for navigation, such as today or the current month, but the field remains `Open-ended`.
4. User selects a day.
5. User confirms the selection, and the field displays that date.
6. User can clear the selection and return the field to `Open-ended`.
7. If the form is submitted while `Valid To` is `Open-ended`, the existing tariff contract persists an open-ended value.

Canceling the picker closes it without changing the field. Focus should return to the trigger after close.

## Component Boundary

The shared component should accept controlled `YYYY-MM-DD` string values:

- `value`: selected date string, or an empty string when allowed.
- `onChange`: receives the committed date string, or an empty string for optional cleared state.
- `label`: visible field label.
- `required`: marks required date fields.
- `requiredIndicator`: preserves current form label behavior.
- `allowEmpty`: enables optional empty state.
- `emptyLabel`: user-facing empty label, e.g. `Open-ended`.
- `min` and `max`: optional date constraints.
- `error`: accessible validation message.
- `disabled`: prevents changes when needed.

The exact prop names can be adjusted during implementation if they better match existing shared UI conventions, but the contract should remain controlled, string-based, and domain-agnostic.

## Data Flow

The component boundary uses `YYYY-MM-DD` strings so React Hook Form integration can remain straightforward.

The forms remain responsible for converting submitted date strings into domain values:

- Required date fields continue to parse non-empty strings into UTC `Date` values.
- Optional tariff `Valid To` continues to submit an empty string as the existing open-ended internal value.
- Existing UTC parsing and formatting semantics must be preserved.
- Existing tariff persistence, session persistence, Dexie storage, Supabase sync, and outbox behavior must not change.

Implementation should prefer the existing canonical charging-plan date helpers where applicable, rather than adding duplicate date conversion logic.

## Validation And Errors

Domain validation stays in the owning forms and services. The picker should not own tariff overlap rules, promotion window rules, session pricing eligibility, or sync constraints.

The picker may enforce UI-level constraints needed for interaction:

- disabled days before `min`
- disabled days after `max`
- required fields cannot be cleared through the UI
- optional fields can expose a clear/open-ended action

Errors must be announced and connected to the interactive control with accessible relationships equivalent to the current input error behavior.

## Accessibility

The picker must support keyboard and pointer use.

Minimum expectations:

- 44px minimum touch targets for trigger and picker actions.
- Trigger has an accessible name from the field label.
- Error text is associated with the trigger/control.
- Picker can be opened, navigated, confirmed, canceled, and cleared without a pointer.
- Escape closes the picker without committing changes.
- Confirming or canceling returns focus to the trigger.
- Disabled or out-of-range dates are communicated to assistive technology.

## Design Governance

This is a `promote to master` design-system change: the app should no longer expose browser-native date-picker rendering as the visible date control pattern. The shared app-controlled picker becomes the standard date picker for the current app.

The design must follow the existing design-system baseline:

- use theme tokens from `src/index.css`
- preserve the thin underline form pattern
- keep labels consistent with existing uppercase form labels
- use tabular date numerals where dates are displayed
- keep touch targets at least 44px
- avoid nested cards or decorative wrappers
- use existing icon conventions, including `lucide-react` where appropriate

## Testing Plan

Add focused shared component tests for:

- required date renders and commits a selected date
- optional empty date renders the configured empty label
- opening an optional empty date does not commit today
- selecting and confirming commits the selected date
- canceling closes without changing the value
- clearing optional value returns to the empty label
- `min` and `max` prevent unavailable selections
- error text is accessible from the control
- keyboard open, navigate, confirm, cancel, and clear paths work

Update integration tests for every migrated form:

- tariff `Valid From` still submits the expected UTC date
- tariff `Valid To` displays `Open-ended` when empty and submits the existing open-ended internal value
- tariff `Valid To` can be selected and cleared
- permanent price change `Effective From` still respects the earliest version date
- temporary promotion start/end still submit the expected dates
- session `Date` still drives effective tariff resolution and session submit behavior

Final verification before implementation handoff or PR:

```bash
npm run lint
npm run test -- --run
npm run build
```

Run `npm run build:analyze` only if the implementation adds a dependency or materially changes bundle/runtime behavior.

## Acceptance Criteria

- Existing open-ended tariffs never show today's date as the saved `Valid To` value.
- `Valid To` displays `Open-ended` when unset.
- Opening `Valid To` while open-ended does not commit a date.
- The user can set and clear `Valid To` with picker controls.
- All visible app date pickers use the same app-controlled component.
- Required date fields keep their current required-date behavior.
- Date UI is consistent across browsers because the visible picker is app-controlled.
- Existing UTC date storage semantics are preserved.
- Offline-first behavior and sync contracts are unchanged.

## Risks

- A custom picker has more accessibility and keyboard behavior to own than native inputs. Mitigate with focused shared component tests and manual browser verification.
- Migrating all date occurrences increases the PR size. Keep the scope narrow: only date picker UI and necessary form integration changes.
- Date helper duplication could introduce drift. Prefer existing canonical helpers where possible and keep conversion responsibility in forms.
- Mobile picker layout can become cramped. Design the picker surface with responsive constraints and 44px targets from the start.
