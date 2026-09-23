# ADR 011: Tariff Navigation and Responsive Action Overlays

## Status

Accepted and implemented. This ADR records the durable navigation, overlay, and
shared-surface contract for the Tariffs redesign.

## Date

2026-09-08

## Context

The chosen Tariffs design separates page creation, ordinary entity navigation,
exceptional entity actions, and persistent app navigation. The implementation
provides that separation without changing the offline-first service contracts.

`App.tsx` owns the active tab, tariff create/edit form state, scroll snapshots,
and focus-restoration requests. A small app-owned history adapter gives Tariffs
two loadable hash locations without introducing a general router. Each current
tariff uses a native main anchor inside a non-interactive Entity Slab, with its
overflow trigger as a sibling. This avoids fake links, card-wide buttons, and
nested controls while preserving reload, new-tab, modified-click, and browser
history behavior.

Exceptional tariff actions use capability-selected sheet/popover overlays with
collision-aware placement. Retire and paid-tariff-switch confirmations provide
body-level portals, background isolation, scroll locking, focus trapping, and
restoration. Delete uses the same modal guarantees.

This decision is presentation and client-navigation only. Tariff writes must
remain local-first through the existing Dexie and outbox contracts. Existing
money, UTC date, version, promotion, retirement, deletion, and historical
snapshot semantics are not open for redesign.

The Sessions screen is a known later consumer of the same design language. It
already uses whole-card activation inside `Slab` and has app-owned edit, scroll,
and focus-restoration state, but it has different content and no equivalent
exceptional-action contract today. Tariffs must therefore establish reusable
design and interaction seams without changing Sessions in this implementation.

## Decision

The application provides two opt-in, domain-neutral shared surface primitives,
one app-owned tariff-location adapter, and one charging-plans-owned
action-overlay implementation. No router, positioning library, browser runner,
or visual-regression dependency is required.

### Reusable Tariffs design building blocks

Tariffs is the first consumer of a small shared surface family under
`src/shared/ui`. The shared layer owns reusable structure and styling roles; it
never owns tariff/session data, navigation state, action eligibility,
confirmation meaning, or persistence callbacks.

The initial opt-in family comprises these conceptual contracts:

- **Page Action Slab:** a scrolling page-heading structure with a semantic
  heading, associated description, and one consumer-supplied primary action
  slot. It owns responsive layout, spacing, and surface treatment. The consumer
  owns copy, list/form visibility, create behavior, and an accessible name and
  minimum 44px target for its action.
- **Entity Slab:** a non-interactive outer article with separate main-content
  and optional trailing-action slots. The main slot supports an interactive
  anchor/button root or a non-interactive root. An interactive root owns its
  ref, accessible name, focus ring, pressed state, and motion behavior; the
  outer article never pretends to be interactive. The main root must not
  contain nested controls, and every overflow control is a sibling in the
  trailing slot.

The shared structures own only padding, radius, spacing, surface roles, and
responsive wrapping. They either use `Slab` with one unambiguous padding and
motion owner or render the surface roles directly; consumers must not stack
conflicting default and feature classes. Shared modules import only platform,
library, and other `shared` APIs. They never import `app` or `features`, expose
domain types, or receive persistence services. Features consume them through
the public `src/shared/ui` entrypoint. Exported props and components receive
concise JSDoc and focused tests. If a proposed abstraction needs a
Tariffs-specific conditional, it remains feature-local behind the same slot
boundary instead of contaminating `shared`.

The Tariffs implementation proves the shared contracts with its own consumer.
It does not import from Sessions or modify `ChargingHistory`. A separately
specified Sessions change may adopt the same Page Action Slab and Entity Slab.
Sessions retains its own content, navigation contract, restoration keys, form
behavior, and domain semantics.

Responsive action presentation is deliberately not a shared component.
Sessions has no corresponding exceptional-action contract, so a
shared sheet/popover API would speculate about a second consumer. Tariffs keeps
the action descriptors, capability adapter, placement helper, sheet, popover,
confirmation handoff, and focus policy feature-local but free of service logic
inside the presentation components. If a later Sessions specification needs
the same mechanics, extract the proven domain-neutral portion in a separate
behavior-preserving change before Sessions adopts it.

### App-owned tariff locations

The adapter recognizes exactly these hash locations while preserving the
existing pathname and query string:

- `#tariffs` identifies the Tariffs list; and
- `#tariffs/edit/<encodeURIComponent(logicalTariffKey)>` identifies the existing
  focused editor for one non-retired logical tariff.

The adapter belongs under `src/app` because it coordinates browser history,
authentication and hydration gates, top-level tabs, and app-owned form state.
The charging-plans feature receives a concrete edit `href` and an activation
callback. Hash parsing and history effects do not enter domain models,
services, `shared`, or `infra`.

The adapter also owns a namespaced `history.state` marker containing the app
tab, a unique entry identity, an optional Tariffs-list scroll snapshot, and,
for an in-app edit entry, the exact Tariffs list-entry identity it was pushed
from. It preserves unrelated history state. On startup, a recognized Tariffs
hash without an app marker is adopted with `replaceState`; a direct edit entry
has no list predecessor. The default for an initial entry without a recognized
hash or app marker remains Sessions.

The location contract is:

1. The parser first isolates the one raw segment after `#tariffs/edit/`, rejects
   an empty suffix or a literal extra `/` segment, and only then decodes the
   segment exactly once. Encoded `/`, `#`, `?`, and `%` remain valid key data. A
   decoding failure is a malformed recognized Tariffs location. Malformed
   Tariffs locations are normalized with `history.replaceState` to `#tariffs`,
   without adding a broken entry. Unknown hashes outside the Tariffs namespace
   remain unowned and do not activate Tariffs.
2. Initial authentication loading does not discard a valid Tariffs location. An
   unauthenticated user continues to see the existing auth gate. Explicit
   sign-out clears the edit hash, tariff form/restoration state, and scroll
   snapshot. Any authenticated user-identity change clears those transient
   values before resolving the location against the new user's data.
3. Target resolution remains local-first. After the owner-scoped provider and
   charging-plan live queries settle, a locally available non-retired target
   with its provider opens immediately even when remote hydration is pending or
   unavailable. A negative result becomes “missing” only after both
   `syncStatus.hydration.providers` and
   `syncStatus.hydration.charging_plans` are `ready`. Until then, loading
   preserves the requested key; failed hydration with no local target displays
   a retryable unavailable state and never claims that the tariff is missing. A
   conclusively missing, deleted, or retired key uses the recoverable
   missing-target surface; it never mutates, recreates, or makes historical data
   editable.
4. Selecting a different top-level tab pushes one marked entry: `#tariffs` for
   Tariffs, or a hashless entry naming Sessions or Analytics. Reselecting the
   already active tab does not add history. Back/Forward restores the tab from
   the marker; a recognized Tariffs hash takes precedence for Tariffs list/edit
   state. Reload of a marked hashless entry restores its marked tab, while a new
   unmarked hashless entry still defaults to Sessions.
5. An unmodified primary activation prevents document reload, records the
   current Tariffs scroll position, pushes the concrete edit location, and opens
   the existing editor. Modified clicks, middle clicks, downloads, and non-self
   targets retain native anchor behavior, so the hash URL is loadable in another
   browsing context.
6. The adapter listens to browser history changes and derives Tariffs list/edit
   state from the recognized location. Back from an in-app editor entry returns
   to the prior Tariffs list entry. Forward may reopen an available target. A
   direct reload or new-tab edit location opens the same target after the
   existing gates complete.
7. Cancel or save may traverse back only when the current edit marker names the
   list-entry identity recorded immediately before the in-app push. Otherwise it
   replaces the current location with a newly marked `#tariffs` entry; it must
   not send the user to an unknown external history entry.
8. Successful save returns to `#tariffs` and requests focus using the logical key
   emitted by the completed local write. This includes a renamed key. The list
   waits for live data and the corresponding main anchor before completing
   focus restoration. Save restores the captured list position before focusing
   the emitted key. Cancel restores the captured position and focuses the
   original main anchor when it still exists. Back to a list entry uses that
   entry's saved position. Forward to an editor captures the position of the
   list it leaves. A direct edit load has no list snapshot, so returning uses the
   list's normal initial position and focuses the target only if available.
9. The target's non-retired lifecycle is rechecked before editor activation and
   on every live-query change while editing. If it becomes retired, deleted, or
   unavailable, the editable form unmounts and the safe unavailable/read-only
   state replaces it without issuing a write.
10. Choosing Sessions or Analytics closes Tariffs form state and clears pending
    Tariffs restoration state. Browser Back may return to an earlier recognized
    Tariffs entry; reloading the marked non-Tariffs entry must not reopen a stale
    editor.
11. The existing auth gate, Sessions/Analytics callbacks, static-hosting
    pathname behavior, and default unmarked Sessions entry remain unchanged.

Only non-retired Entity Slabs receive edit links. Retired history remains
read-only and keeps Create new from retired as an explicit creation workflow.

### Charging-plans-owned responsive action policy

The charging-plans feature owns one action definition and one overlay state
machine together with the sheet/popover presentation mechanics. `src/app` does
not inspect tariff action availability, and shared UI does not acquire
Tariffs-specific policies. The tariff action definition preserves existing
eligibility and callbacks and renders, in order:

1. Promotion;
2. separated Retire when eligible; and
3. separately grouped Delete.

Edit, Add, and ordinary card navigation are not exceptional actions. Retire and
Delete keep distinct names and confirmations. Closing or selecting an action
must dispatch at most once and preserve pending snapshots.

One pure feature-local selector receives an injected capability snapshot. The
`md` boundary is the existing 768 CSS-pixel breakpoint. Presentation is selected
by this complete truth table:

- width below 768px always uses the modal action sheet;
- width at or above 768px uses the anchored menu only when both
  `(pointer: fine)` and `(hover: hover)` match; and
- every coarse, no-hover, unavailable, or contradictory capability result uses
  the sheet, including a large touch-only tablet.

A capability change while open must leave exactly one presentation. It either
preserves the same logical action and valid focus in the replacement or closes
safely and restores the trigger.

The trigger and active presentation share stable generated IDs. The trigger
exposes `aria-expanded`, `aria-controls`, and `aria-haspopup="dialog"` for the
sheet or `aria-haspopup="menu"` for the anchored menu. The sheet has a stable
accessible name and ordinary buttons; the menu uses `menu`/`menuitem`. Disabled
and pending actions remain perceivable and non-dispatching in both forms.

### Tariffs modal action-sheet mechanics

The compact presentation is a labeled dialog in a body-level portal
above the mobile dock. It owns an opaque action slab, separate Cancel slab,
scrim, bottom safe-area padding, bounded height, and internal scrolling. Opening
it must not reflow the document or change the saved scroll position.

While open, the sheet makes all other body roots inert, locks body scrolling,
moves focus inside, traps Tab, handles Escape, Cancel, and scrim dismissal, and
restores the captured trigger or a logical-key fallback. Trigger restoration
uses a captured element or key-addressed ref map; it never searches global
display labels. Pending actions may disable dismissal where the existing
destructive workflow already requires that guard.

### Tariffs anchored-menu mechanics

The regular fine-pointer presentation is a body-level portal using fixed
coordinates. A pure feature-local placement helper receives the trigger
rectangle, measured overlay size, visual viewport rectangle including non-zero
offsets, edge gap, and any visible mobile-dock exclusion rectangle. It prefers
below and end-aligned, flips above when required, then shifts within the usable
rectangle. If neither side fits, the menu scrolls within a bounded height or
falls back to the sheet; it must not cover persistent navigation.

Placement is recomputed on window scroll/resize and `visualViewport`
scroll/resize, falling back to the layout viewport when `visualViewport` is
unavailable. A disconnected trigger closes the menu safely. The menu uses
initial action focus, Arrow/Home/End navigation, Escape and outside dismissal,
visible focus, and key/ref-based trigger restoration.

### Overlay-to-confirmation ownership

One feature-owned surface state identifies the active action overlay or
confirmation. Before Retire or Delete confirmation becomes interactive, the
action overlay must be fully closed. Its cleanup receives an explicit
do-not-restore-focus handoff policy; focus transfers directly to the incoming
confirmation instead of briefly returning behind it.

Only one Tariffs modal layer may own inert state, scroll lock, Escape, and focus
at a time. The captured trigger element and logical tariff key survive the
handoff so final cancellation, success, or failure restoration can resolve a
connected target. If live data removes the trigger, restoration falls back
safely without recreating the entity.

Delete is a body portal with the same isolation, scroll, focus,
Escape, pending, error, and restoration guarantees as the proven confirmation
pattern. Retire keeps its irreversible warning, final-active-date and version
snapshot semantics. Both destructive confirmations use destructive treatment
with a neutral Cancel; neither service contract changes.

### App-shell modal exclusion

The existing provider-conflict recovery dialog is an independent app-level
body portal with the same inert, scroll, Escape, and focus responsibilities.
It must never overlap a Tariffs sheet or confirmation. The app shell therefore
owns a narrow exclusion handshake, not a general shared modal manager:

- opening provider-conflict recovery first requests closure of any non-pending
  Tariffs overlay with focus restoration suppressed, then opens recovery after
  that cleanup is acknowledged;
- a pending Tariffs confirmation cannot be pre-empted, so the provider-recovery
  request waits or remains unavailable until the pending operation settles;
- while provider-conflict recovery is open, Tariffs refuses new action-sheet or
  confirmation requests; and
- a non-modal desktop menu closes through its outside-focus/pointer path before
  the provider-recovery activation is dispatched.

The app shell coordinates only whether these surfaces may open; it does not
receive tariff action definitions or confirmation semantics. Tests must prove
that at most one body portal owns modal isolation and that overflow/inert/focus
snapshots restore exactly after each permitted transition. A future
programmatically opened app modal must extend or replace this handshake through
a separate architecture decision.

### Opt-in shared design family and staged Sessions adoption

The chosen Tariffs design's page/entity radii, opaque Floating Slab surfaces,
spacing, interactive card states, and preferred font order remain a Tariffs
**local exception** and a **promote to master candidate** for a later Sessions
change. The shared Page Action Slab and Entity Slab expose the opt-in structure
without changing any existing consumer.
Tariffs supplies its visual variant using existing shared color, edge, shadow,
and accent roles. It does not globally restyle `Slab`, Sessions, or Analytics.
Tariffs action-overlay geometry remains feature-local and is not promoted merely
because Sessions is the next visual consumer.

Tariffs is the proving consumer. Its implementation and Browser evidence
stabilize both shared structures and the visual variant. Reuse by Sessions is
the evidence needed to promote those visual values from candidate to shared
baseline; the Tariffs ADR alone does not promote them.

The follow-up Sessions change requires its own audit/specification, task plan,
routing, tests, Browser evidence, and explicit authorization. It should reuse
the proven shared components rather than copy Tariffs classes, while retaining
Sessions-specific grouping, totals, card content, create/edit behavior,
offline semantics, and focus restoration. Any contract change discovered by
Sessions is reviewed as a shared API evolution, not patched into Tariffs through
cross-feature imports.

Any shared dock-token adjustment remains separate from the surface family. It
must be validated atomically across all three destinations and documented as
shared shell behavior rather than silently bundled into the Sessions follow-up.

### Sessions follow-up outcome (2026-09-23)

PR #229 completed the separately authorized Sessions follow-up. Sessions adopted
the shared Page Action Slab for its in-flow create action and supplied the second
consumer evidence needed to promote that page-level structure to the design
baseline. Copy, visibility, callbacks, and focus-restoration state remain owned
by each consumer.

The follow-up did not adopt `EntitySlab`, Tariffs hash navigation, exceptional
actions, the capability selector, sheet/popover presentation, or confirmation
handoff. Sessions retains chronological groups and native whole-card buttons in
`Slab`; those differences are intentional rather than incomplete Tariffs reuse.
Accordingly, `EntitySlab` remains opt-in and Tariffs action overlays remain
feature-local. No shared API change or global slab restyle was required.

## Preserved Product and Data Contracts

- Creation and editing remain available offline and persist through existing
  Dexie/outbox services before later Supabase synchronization.
- Money remains integer cents rendered as EUR with existing labels and without
  an inferred `/kWh` suffix. Missing optional values remain unavailable, not
  zero; valid zero energy rates and omitted zero fees retain current behavior.
- Logical tariff keys, stored provider/profile names, UTC intervals, scheduled
  and ending-today states, promotions, paid-switch behavior, and charging-session
  pricing snapshots do not change.
- Retire remains an irreversible lifecycle action that preserves history and
  cancels future versions/promotions through the existing service.
- Delete remains a distinct exceptional action with its existing complete-timeline
  service and confirmation meaning. Removing it needs separate product approval.
- Retired history stays immutable; Create new from retired creates an ordinary
  new tariff and is not an undo operation.
- The Tariffs implementation does not alter Sessions markup, behavior, tests, or stored
  data. Sessions adoption is a later product change with its own authorization.
- No Supabase schema, RLS, RPC, migration, production-data, authentication, or
  service-role change is part of this decision.

## Alternatives Considered

### Add a client router

Rejected for this scope. The app needs two Tariffs locations, not a wholesale
navigation migration. A router would add dependency, hosting, test, and
cross-feature work without improving the required tariff contract.

### Use a button, clickable card, or placeholder href

Rejected. These options cannot provide meaningful destination semantics,
reload/new-tab behavior, or native modified-click behavior. A clickable card
would also risk nesting the overflow control inside another interactive target.

### Keep the menu local and only raise its z-index

Rejected. A higher local menu would cover the dock instead of respecting it and
would not solve downward-only placement, viewport clipping, modal isolation, or
keyboard behavior.

### Select the overlay by width alone

Rejected. Large touch-only tablets need the sheet, while regular fine-pointer
layouts benefit from an anchored menu. Primary pointer and hover capability are
part of the contract, with ambiguity failing safely to the sheet.

### Introduce a global overlay manager now

Rejected. Existing dialogs work without a global manager, and the immediate
Tariffs handoff policy is feature-local. The bounded app-shell exclusion
handshake covers the one known cross-root collision without introducing a
global store or app-wide modal framework. A manager would expand risk before
multiple consumers prove that need.

### Keep the Page Action and Entity Slabs inside the Tariffs feature

Rejected. Sessions is an identified follow-up consumer, so copying Tariffs
structure and classes later would create avoidable drift. Sharing these two
domain-neutral slot structures now creates a stable opt-in seam while holding
Tariffs navigation, content, and policy feature-local.

### Share responsive entity actions before a second consumer exists

Rejected. Sessions has no current exceptional-action contract. The Tariffs
sheet, popover, placement, and focus behavior remain feature-local
until a later specification proves which mechanics a second consumer actually
shares; only then may a behavior-preserving extraction move them to `shared`.

### Redesign Tariffs and Sessions together

Rejected. Sessions has different content and current interaction contracts and
has not received the same audit or product approval. Coupling both screens would
expand the refactor, obscure Tariffs acceptance, and violate the requirement
that Sessions adoption occur in a later change.

### Remove Delete or make retired cards editable

Rejected without separate product authorization. Delete is an existing distinct
destructive workflow, and editing retired history would contradict lifecycle
and snapshot safeguards.

## Consequences

- Current tariffs gain real browser-addressable edit destinations without a
  general router or any backend change.
- `src/app` gains a small browser-history responsibility that must be tested for
  auth loading and principal changes, charging-plan hydration failure,
  malformed/stale/live-changing targets, reload, Back/Forward, modified clicks,
  cancellation, save/rename, tab leave, scroll, and focus transitions.
- The charging-plans feature gains portal, capability, placement, and focus
  orchestration, while shared UI gains only the opt-in Page Action and Entity
  Slab structures. Shared tests prove those generic contracts; Tariffs tests and
  Browser geometry/focus validation prove the first consumer. Component tests
  alone cannot prove collision freedom.
- The original mobile collision and Escape failure are fixed without moving
  creation into the dock or changing ordinary tariff services.
- Hash locations remain compatible with static SPA hosting and preserve the
  pathname/query string, but other features remain state-only until a separate
  routing decision is approved.
- The encoded logical key can contain a normalized user-entered tariff name and
  is visible in browser history; encoding is not confidentiality. Explicit
  sign-out clears the edit location, and no hash value is trusted without
  owner-scoped, settled local data.
- The app shell gains one narrow provider-recovery/Tariffs modal exclusion
  handshake. It is not a general modal framework and must be reconsidered if a
  third independently opened app modal is introduced.
- A later Sessions redesign can reuse the proven visual structure and mechanics
  without importing Tariffs code. It still requires a separate decision about
  session navigation and actions and does not begin as part of this ADR.
- Rollback requires no data migration. A rollback stops interpreting the new
  hash contract; deployment or rollback handling should normalize a recognized
  Tariffs edit hash to the list rather than leave a stale editor expectation.
- Physical iPhone Safari and installed-PWA safe-area behavior cannot be claimed
  complete until it is tested on those environments.

## Implementation and Acceptance Boundary

This ADR records implemented behavior and remains the durable governing
contract. The implementation tracker may sequence maintenance work, but it is
not a dependency of this document. Sessions adoption was completed as the
separate, explicitly authorized change recorded above.
