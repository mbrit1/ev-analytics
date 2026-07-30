# Add a Provider While Creating a Tariff

## Problem Statement

The tariff form requires an existing provider, but the application has no
user-facing way to create one. Existing providers were imported into the
database, so adding a new provider currently requires another manual database
operation.

How might we let a user add a provider and its first tariff in one clear,
offline-first workflow without leaving an empty provider behind when the tariff
is cancelled or fails to save?

## Recommended Direction

Keep the existing Provider select as the default control in the New Tariff
form. Directly below it, show a prominent design-system secondary button:
**Add new provider**. Supporting copy such as **Provider not listed?** may
introduce the action.

Selecting the button switches the provider section into new-provider mode:

- Replace the existing-provider select and add action with a required
  **New Provider Name** thin-underlined input.
- Move focus to the new input.
- Show a secondary **Back to provider list** action.
- Discard the staged provider name when the user returns to the provider list.
- If no active providers exist, open the form in new-provider mode and omit the
  back action.

The provider remains staged until the user submits the complete tariff form.
**Save Tariff** creates the provider and tariff in one local Dexie transaction
and adds their outbox entries in dependency order: provider first, tariff
second. The transaction commits both records or neither record.

This improves on an earlier inline-add interaction that saved the provider
immediately. Immediate persistence is not suitable while the application has
no provider-management workflow because cancelling the tariff could otherwise
leave an orphan provider.

## Product Requirements

### Existing-provider mode

- The existing Provider select remains the initial state when at least one
  active provider exists.
- Selecting an existing provider preserves the current tariff-creation
  behavior.
- A full-width or otherwise prominent **Add new provider** secondary button is
  visible without opening the select.

### New-provider mode

- Provider name is the only new provider field.
- Provider name is required and trimmed before validation and persistence.
- The new provider is not persisted when entering new-provider mode.
- **Back to provider list** restores the select and discards the staged name.
- Cancelling the tariff form persists neither the staged provider nor tariff.

### Validation and duplicate recovery

- Active provider names remain unique per user after trimming and
  case-insensitive comparison.
- A duplicate name keeps the form open and displays an inline, field-associated
  error.
- Duplicate feedback offers a direct action such as **Select EWE Go instead**.
  That action returns to existing-provider mode with the matching provider
  selected.

### Atomic offline-first persistence

- The workflow remains fully available without connectivity.
- The provider, tariff, and both outbox entries are written in one local
  transaction.
- The provider outbox entry precedes the tariff outbox entry so remote replay
  respects the foreign-key dependency.
- Any validation or persistence failure rolls back the complete transaction
  and leaves the user's form values available for correction or retry.
- Existing authenticated ownership, Supabase RLS, and synchronization contracts
  remain unchanged.
- No database migration or remote schema change is required.

### Design and accessibility

- Follow `docs/design/design-system-baseline.html` and
  `docs/design/governance-checklist.md`.
- Use the established uppercase metadata labels, thin-underlined inputs,
  secondary-action treatment, focus states, and form spacing.
- All interactive controls have at least a 44px touch target.
- Controls retain stable label relationships and expose field errors
  accessibly.
- The mode transition moves focus predictably and works with keyboard,
  touch, mobile, and desktop layouts.
- Do not introduce a custom combobox solely for this workflow.

## Success Criteria

- A user with existing providers can create a tariff for one of them exactly as
  today.
- A user can switch to new-provider mode, enter a provider name, complete the
  tariff, and save both records while offline.
- A user with no providers is presented directly with the new-provider input.
- Cancelling or returning to the provider list creates no provider record or
  outbox entry.
- A failed tariff save creates no provider record or outbox entry.
- A duplicate provider name provides an inline path to select the existing
  provider.
- Successful synchronization sends the provider before its tariff.
- Mobile and desktop browser validation confirms the workflow follows the
  current design baseline.

## Key Assumptions

- A provider represents the billing provider/eMSP that owns one or more
  tariffs.
- Provider name is sufficient for provider creation in the current product.
- The first supported provider-creation workflow always creates its first
  tariff at the same time.
- Provider editing, deletion, and standalone management are separate product
  needs.

## MVP Scope

- Add-provider mode inside the New Tariff form.
- One required provider-name field.
- Atomic local creation of the provider and first tariff.
- Dependency-ordered outbox entries.
- Duplicate-name recovery.
- Responsive and accessible design-system integration.

## Not Doing

- Provider editing, deletion, or restoration.
- A standalone provider-management page.
- Additional provider metadata.
- Provider creation from charging-session forms.
- Persisting a provider before its tariff is saved.
- A searchable create-or-select combobox.
- Database migrations, schema changes, or new dependencies.

## Open Questions

No product-blocking questions remain. Exact helper and error copy may be tuned
during browser validation without changing the agreed interaction or
persistence contract.
