# Session Editing Design

## Context

The app already supports creating charging sessions through
`src/features/charging-sessions/components/SessionForm.tsx`. When the user
chooses `Add Session`, the current history list disappears and the form becomes
the active view inside the sessions tab.

The next change is to let users edit an existing session by tapping its history
card. The edit experience should reuse the existing form surface and keep the
same mode-switching model as create: users should either see the history or the
form, not both at once.

This work must preserve the app's offline-first model. Editing a session must
work without connectivity, persist locally first, and rely on the existing
outbox-based sync system for eventual remote reconciliation.

## Goals

- Allow users to tap/click a session card in charging history to edit it.
- Reuse the existing `SessionForm` UI for editing.
- Prefill the form with the selected session's current values.
- Replace the existing session entry in place when saving edits.
- Return to charging history after a successful edit save.
- Keep create-session behavior unchanged for blank new entries.
- Keep `Pricing Source` fixed during editing and show it as read-only.

## Non-Goals

- Adding delete-session behavior.
- Introducing dedicated edit routes or deep-linkable edit screens.
- Supporting conversion from plan sessions to ad-hoc sessions or vice versa.
- Redesigning the session-card layout beyond making it clearly interactive.
- Adding modal editing, split-pane editing, or side-by-side history/form views.
- Changing sync architecture, outbox semantics, or tariff snapshot policy.

## Approved Approach

Keep form-mode ownership at the app-shell level rather than splitting it across
multiple components.

`src/app/App.tsx` should continue to be the single place that decides whether
the sessions tab shows history or the form. Instead of a create-only boolean,
the app should track session-form mode with enough context to represent:

- closed,
- create,
- edit(selected session).

`src/features/charging-sessions/components/ChargingHistory.tsx` should remain a
list/presentation component and emit selection events upward when a session card
is activated.

`src/features/charging-sessions/components/SessionForm.tsx` should remain the
single entry form for both create and edit. It already supports `initialValues`
and should use that path for edit-mode prefilling.

For persistence, editing should use an explicit update path that preserves the
existing session identity instead of implicitly creating a new record.

## Interaction Model

The sessions tab should continue to behave as a two-mode surface:

- History mode: shows `Charging History` and the session list.
- Form mode: shows `SessionForm` for either create or edit.

Edit flow:

1. User taps/clicks a session card in history.
2. History view is replaced by the prefilled edit form.
3. User updates values and chooses `Save Session` or `Cancel`.
4. `Cancel` returns to history with no persisted changes.
5. `Save Session` updates the existing entry, closes the form, and returns to
   history.

Edits are persisted only when the user chooses `Save Session`. Canceling or
otherwise leaving the edit form discards all unsaved changes without
confirmation.

Create flow remains unchanged:

1. User chooses `Add Session`.
2. History view is replaced by a blank form.
3. Save creates a new entry and returns to history.

The edit flow must not leak state into create flow. Starting a new session after
editing should open a blank form with normal create defaults.

## Card Interaction and Affordance

Each session card in
`src/features/charging-sessions/components/ChargingHistory.tsx` becomes the edit
trigger.

Rules:

- The whole card is clickable/tappable.
- There is no separate `Edit` button on the card.
- Cards should communicate interactivity through subtle states rather than new
  visible controls.
- The card's visual treatment must make it recognizable as an interactive
  element across pointer and touch layouts while preserving the existing
  content hierarchy.
- Desktop behavior should include pointer/hover cues.
- Keyboard users must be able to focus and activate a card.
- Each card must expose an accessible name that identifies the session and
  communicates that activating it opens that session for editing.
- Focus styling must remain visible and consistent with the existing design
  system.

Recommended implementation shape:

- give each card button-like semantics,
- preserve the current card content hierarchy,
- add hover/pressed/focus treatment only,
- avoid introducing secondary helper copy such as `Tap to edit` unless needed
  later.

## Form Behavior in Edit Mode

The edit screen should be the same `SessionForm` used for creation, with the
following behavior changes driven by edit context:

- Title remains `Edit Session`.
- Existing session values are prefilled.
- `Pricing Source` is shown in the form but is read-only.
- The read-only `Pricing Source` should clearly state either `Charging Plan` or
  `Ad-Hoc`.
- All other currently editable session-detail fields remain editable.
- Saving an edit without changing any values must preserve all existing session
  data and must not alter its historical meaning.
- For plan sessions, changing only usage/detail fields such as billed energy,
  odometer, state of charge, or notes must reuse the persisted price snapshot,
  plan-selection id, provider snapshot, and plan snapshot. The total may be
  recalculated from the persisted applied price and session fee.
- Changing a plan session's pricing identity means changing its provider, plan,
  session date, charging type, or standard/roaming rate. That deliberate change
  recalculates the pricing snapshot from the selected current plan and may create
  or select the corresponding plan-selection history row.
- A persisted provider or plan that is no longer active must remain visible as a
  fallback option so an unchanged historical session can still be opened and
  saved. Selecting a different active provider or plan remains allowed.

Reason for locking `Pricing Source`:

- Editing is meant to adjust an existing session, not transform it into a
  different type of record.
- Cross-type conversion adds behavioral ambiguity around snapshots, plan
  linkage, and historical meaning.
- The user expectation is that switching session type belongs to a future
  delete-and-recreate workflow, not this edit flow.

This means:

- plan sessions can only be edited as plan sessions,
- ad-hoc sessions can only be edited as ad-hoc sessions.

## Persistence and Sync Behavior

Editing must preserve the existing session `id`.

Required behavior:

- save the edited row back into Dexie under the same `id`,
- update mutable fields from the edited form values,
- preserve `id`, `user_id`, `created_at`, pricing source, and soft-delete state
  from the stored row rather than trusting caller-provided replacements,
- for unchanged plan pricing identity, preserve historical snapshot fields and
  recalculate the total from the persisted applied unit price and session fee,
- for deliberately changed plan pricing identity, recalculate totals and
  snapshots from the newly selected plan/rate and update plan-selection history,
- for ad-hoc sessions, recalculate totals and snapshots from the edited ad-hoc
  pricing fields while keeping the session in ad-hoc mode,
- enqueue sync for the same logical session row through the existing outbox
  mechanism,
- return control to the UI only after the local transaction succeeds.

The edit save path should be explicit rather than relying on create semantics.
That keeps intent clear in tests and reduces the chance of accidental duplicate
records or mismatched outbox entries.

The update persistence function must reject a missing local row. It must not use
an upsert operation that can silently create a new session during an edit.

Offline-first rules remain unchanged:

- editing must succeed locally while offline,
- sync errors after local save are handled by the existing sync-status surfaces,
- edit mode does not need its own sync-specific recovery UI.

## Error Handling

If a local update fails:

- keep the form open,
- show a submit-level error using the existing `SessionForm` error pattern,
- do not navigate back to history.

If a sync failure happens later:

- the session remains locally updated,
- the outbox entry remains available for retry,
- the existing sync-status indicator and blocking-error handling remain the
  user-facing recovery path.

## Component Boundaries

Proposed boundary changes:

- `src/app/App.tsx`
  - own the create/edit/closed session-form mode,
  - pass an edit-selection callback into `ChargingHistory`,
  - choose the correct submit path for create vs edit.
- `src/features/charging-sessions/components/ChargingHistory.tsx`
  - accept an `onSelectSession` callback,
  - emit the selected session when a card is activated,
  - add interactive semantics and states to cards.
- `src/features/charging-sessions/components/SessionForm.tsx`
  - continue to accept `initialValues`,
  - render read-only pricing-source UI in edit mode,
  - keep create-mode pricing-source selection unchanged.
- `src/features/charging-sessions/services/sessionService.ts`
  - add or expose an explicit update path for existing sessions,
  - keep local-write plus outbox-write behavior atomic.

No new cross-feature boundary should be introduced. The sessions feature should
continue using charging-plan hooks/services only through approved public
interfaces.

## Testing

Update coverage in these areas:

### `src/features/charging-sessions/components/ChargingHistory.test.tsx`

- clicking/activating a session card calls the selection callback with the
  correct session,
- cards expose interactive semantics appropriate for keyboard access,
- existing session content still renders correctly.

### `src/features/charging-sessions/components/SessionForm.test.tsx`

- edit mode pre-populates fields from an existing plan session,
- edit mode pre-populates fields from an existing ad-hoc session,
- `Pricing Source` is read-only in edit mode,
- create mode still allows selecting `Pricing Source`.
- unchanged plan edits preserve persisted snapshots and do not mutate
  plan-selection history,
- a deliberate pricing-identity change recalculates from the selected plan and
  uses the corresponding plan-selection row,
- inactive persisted provider/plan values remain selectable as historical
  fallback options.

### app-level test coverage

- selecting a history card replaces history with the edit form,
- canceling edit returns to history,
- saving edit returns to history,
- a rejected local update keeps the edit form open and surfaces the existing
  submit-level error,
- add mode still opens a blank form,
- edit state does not leak into subsequent create mode.

### service tests

- updating an existing session preserves `id`,
- updating rejects an unknown id rather than inserting a new row,
- updating preserves stored `user_id`, `created_at`, pricing source, and
  soft-delete state,
- updating writes the changed row locally,
- updating enqueues sync correctly for the same session,
- local session and outbox writes roll back together when queue insertion fails,
- create behavior remains unchanged.

## Risks and Guardrails

Primary risks:

- accidentally creating a second record instead of updating in place,
- unintentionally allowing pricing-source conversion during edit,
- making cards appear interactive visually but not semantically for keyboard
  users,
- leaking edit-specific defaults into create mode.

Guardrails:

- keep form-mode ownership centralized in `App`,
- use an explicit update path in the session service,
- test create and edit flows separately,
- keep `Pricing Source` read-only in edit mode,
- preserve current offline-first transaction and outbox behavior.

## Verification Expectations

Before implementation is considered complete, verify with:

- targeted component tests for history-card activation and edit-form behavior,
- targeted service tests for update persistence and outbox behavior,
- app-level interaction tests for create/edit mode transitions,
- full repo verification per project guidance before merge:
  - `npm run lint`
  - `npm run test -- --run`
  - `npm run build`
