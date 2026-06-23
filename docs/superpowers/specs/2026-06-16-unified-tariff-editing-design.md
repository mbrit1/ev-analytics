# Unified Tariff Editing Design

## Context

The tariffs screen currently splits editing across multiple surfaces:

- `New Tariff`
- `Edit details`
- `Permanent Price Change`
- `Run temporary promotion`

That split creates two UX problems:

1. the permanent-change flow does not make it obvious which logical tariff is
   being edited,
2. the tariffs screen does not behave like the sessions screen, because the edit
   form appears above the existing list instead of replacing it as the active
   view.

The sessions tab already establishes the preferred interaction model for long
   lists:

- list mode and form mode are mutually exclusive,
- opening edit preserves list context,
- save or discard returns the user to the same place they launched from.

This design aligns tariff editing with that sessions pattern while simplifying
the tariff editing surface area.

## Goals

- Reuse one tariff form UI for both create and edit workflows.
- Remove the separate `Edit details` surface.
- Remove the separate `Permanent Price Change` surface.
- Keep `Run temporary promotion` as a dedicated workflow.
- Make tariff editing behave like session editing: the user sees either the list
  or the form, not both.
- Preserve scroll/list context so saving or discarding returns the user to the
  same tariff card they launched from.
- Make the tariff identity obvious through the actual form fields rather than
  extra explanatory copy.
- Allow typo corrections to tariff names directly in the unified form.
- Preserve tariff-version history semantics and historical session snapshots.

## Non-Goals

- Redesigning the temporary-promotion workflow.
- Changing the logical-tariff grouping model.
- Repricing historical sessions.
- Allowing provider changes for existing logical tariffs.
- Introducing route-based tariff editing.
- Reworking the underlying offline sync architecture.

## Approved Approach

Use the existing `New Tariff` form shell as the single create/edit surface for
tariffs.

For create mode, the form remains functionally equivalent to today’s new-tariff
flow.

For edit mode, the same form becomes the only active tariffs surface and is
prefilled from the selected logical tariff’s current version. Existing tariffs
must not open separate `Edit details` or `Permanent Price Change` cards.

The edit action therefore becomes a focused form workflow with the same
interaction model as session edit:

- opening edit hides the tariff list,
- the form becomes the only active content surface for the tariffs tab,
- closing, discarding, or saving returns to the list view,
- the list resumes at the same launch position.

## Interaction Model

The tariffs tab becomes a two-mode surface:

- List mode: shows the tariffs overview list.
- Form mode: shows one tariff form surface for create or edit.

### Create flow

1. User taps/clicks `Add Tariff`.
2. Tariff list is replaced by the unified tariff form in create mode.
3. User saves or cancels.
4. Save creates a new logical tariff/version and returns to the list.
5. Cancel closes the form and returns to the list.

### Edit flow

1. User taps/clicks the tariff `Edit` action from a logical tariff card.
2. Tariff list is replaced by the unified tariff form in edit mode.
3. The form is prefilled from the selected logical tariff’s current version.
4. User saves or discards.
5. Save applies either an in-place update or a new successor version, depending
   on `Valid From` behavior.
6. Save or discard returns to the list at the same scroll position and same
   logical tariff card.

### Overflow actions

After this change, the overflow menu should no longer include:

- `Edit details`
- `Change price permanently`

The remaining secondary actions are:

- `Run temporary promotion`
- `Delete tariff`

The visible primary `Edit` action now opens the unified tariff editor.

## Form Behavior

The existing tariff form UI is reused rather than introducing a dedicated
editing form.

### Shared create/edit behavior

The form continues to show the existing tariff fields, including:

- tariff name,
- provider,
- valid-from date,
- valid-to date where applicable,
- pricing fields,
- descriptive detail fields already supported by the form.

The field layout should remain visually consistent with the current `New Tariff`
experience.

### Edit-mode rules

When editing an existing logical tariff:

- `Provider` is visible but not editable.
- `Tariff Name` remains a normal text field and is editable.
- The form is prefilled from the current effective version of the selected
  logical tariff.
- The form title and action wording should clearly indicate edit mode while
  still using the same underlying form shell.
- The identity of the tariff is communicated by the locked provider field and
  editable tariff-name field, not by extra helper headers or separate summary
  cards.

### Provider immutability

Provider changes are not allowed in edit mode because the provider is part of
logical tariff identity. Allowing a provider change inside edit would silently
move the tariff into a different logical identity and complicate history
grouping.

Provider selection remains editable only in create mode.

## Persistence Semantics

The submit path for edit mode depends on whether the user changed the
`Valid From` value from the current version’s original start date.

### Case 1: `Valid From` unchanged

If the user leaves `Valid From` unchanged, saving edits the current effective
version in place.

This is the intended path for changes such as:

- correcting the tariff name,
- updating notes or affiliation,
- correcting current pricing values that should belong to the existing version,
- adjusting other editable current-version details without creating a new dated
  successor.

Required behavior:

- preserve the existing current-version row identity,
- update editable fields on that version,
- keep historical versions unchanged,
- keep historical charging-session snapshots unchanged,
- keep the logical tariff grouped under the same provider/name identity after
  applying any normalized name update.

### Case 2: `Valid From` changed

If the user changes `Valid From`, saving creates a new successor version that
starts on the chosen date.

This is the intended replacement for the current permanent-price-change flow.

Required behavior:

- treat the changed `Valid From` as deliberate versioning intent,
- prefill from the current version when entering edit mode,
- create a successor version beginning on the new start date,
- keep the preceding version effective through the day before the new start
  date,
- preserve a continuous, non-overlapping logical tariff history,
- block submission when the requested start date conflicts with existing
  scheduled versions or promotions.

## Versioning Rules

The existing tariff version-management rules remain in force unless explicitly
changed below.

### Logical identity

Logical tariff identity remains:

- provider,
- normalized tariff name.

If the tariff name is edited in place while `Valid From` is unchanged, the
logical tariff identity should be updated consistently across the logical tariff
history in the same way the existing details-edit path updates descriptive
identity.

### Historical correctness

- Historical versions are never overwritten by a future successor action.
- Historical charging sessions keep their stored price snapshots and labels.
- Promotions remain their own dedicated version-management flow.
- The unified edit form must not silently collapse or bypass existing promotion
  constraints.

### Conflict handling

Changing `Valid From` must continue using the same class of schedule/conflict
validation already required for permanent price changes:

- no overlapping versions,
- no ambiguous effective dates,
- no silent replacement of existing scheduled changes,
- no silent disruption of promotional restoration.

## List Context Preservation

Tariff editing must adopt the same long-list return behavior as the sessions
screen.

When the user opens edit from a tariff card, the UI should capture:

- the selected logical tariff key,
- enough scroll context to restore the user to the same visual position after
  exit.

On `Save` or `Discard`:

- the tariffs list is shown again,
- the previously selected logical tariff card is restored into view,
- the user returns to the same scroll context they were at when they launched
  edit, with the originating logical tariff card visible without manual
  scrolling.

This behavior must work for long tariff lists and must not always send the user
back to the top of the screen.

## Component Boundaries

The design should follow the same ownership model used by session editing: a
parent surface decides whether the tab shows list mode or form mode.

### `src/features/charging-plans/components/TariffList.tsx`

Should:

- own the tariffs list vs form-surface mode,
- open the unified form for create and edit,
- preserve launch context for return-to-list restoration,
- hide the list while create/edit form mode is active,
- continue owning promotion and delete entry points.

Should no longer:

- render `Edit details` as a separate surface,
- render `Permanent Price Change` as a separate surface above the list.

### Tariff form component(s)

The existing new-tariff form surface should be extended to support edit mode
rather than duplicated.

Edit mode needs enough input context to:

- lock provider,
- prefill the current logical tariff/version,
- compare original vs submitted `Valid From`,
- route submit behavior to in-place update vs successor-version creation.

### Charging-plan services/hooks

The charging-plan submit path should expose two explicit edit intentions:

- update current version in place,
- create successor version from a new start date.

That branch must be intentional in the service layer rather than inferred later
from partial UI state.

## Validation And Error Handling

### Shared form validation

- Required fields remain required.
- Money fields remain valid non-negative amounts.
- Invalid submissions keep entered values in place.
- Submit-level failures keep the form open and show an error in the existing
  form error pattern.

### Edit-mode validation

- Provider cannot be changed.
- If `Valid From` is unchanged, submit uses the in-place update path.
- If `Valid From` changes, the new date must pass version-scheduling
  validations.
- If the changed date conflicts with existing scheduled versions or promotions,
  saving is blocked with clear date-oriented copy.

### Return behavior after failure

If save fails locally or fails validation:

- keep the unified form open,
- keep the user-entered values,
- do not return to the list,
- do not lose the stored launch context.

## Testing

Update or add coverage in these areas.

### `src/features/charging-plans/components/TariffList.test.tsx`

- opening edit hides the tariffs list and shows only the unified form surface,
- save returns to list mode,
- discard returns to list mode,
- edit no longer opens separate details or permanent-change surfaces,
- launch context is preserved so return-to-list restoration targets the same
  logical tariff card.

### Tariff form tests

- create mode still supports editable provider selection,
- edit mode locks provider,
- edit mode keeps tariff name editable as text,
- edit mode prefills from the current logical tariff version,
- unchanged `Valid From` routes to in-place update behavior,
- changed `Valid From` routes to successor-version creation behavior,
- validation blocks conflicting changed start dates without clearing user input.

### Charging-plan service tests

- updating with unchanged `Valid From` edits only the current version,
- changing `Valid From` creates a new successor version,
- name corrections with unchanged `Valid From` do not create a successor,
- historical session snapshots remain unchanged after either edit path,
- existing promotion and schedule conflict rules remain enforced.

## Open Decisions Resolved

The following decisions are now explicit:

- The sessions screen is the UX model for tariff editing.
- The unified tariff editor replaces both `Edit details` and `Permanent Price
  Change`.
- `Provider` is immutable in edit mode.
- `Tariff Name` is editable text in edit mode.
- If `Valid From` changes, saving creates a new version.
- If `Valid From` does not change, saving updates the current version in place.
- Save and discard return the user to the same place in long tariff lists.
