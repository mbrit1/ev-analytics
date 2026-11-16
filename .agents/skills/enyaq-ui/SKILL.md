---
name: enyaq-ui
description: >
  Automatically use for substantial Enyaq Suite UI changes to information
  hierarchy, metrics, navigation, or interaction patterns, and for substantial
  visual UI design or review. Keep small text and style fixes lightweight.
---

# Enyaq Suite UI design workflow

## Before implementation

For a small, clearly specified text or style fix, proceed directly to the edit
and check the affected UI. For substantial changes, identify the owning screen
and the user's intent. For an existing screen,
capture or obtain a current screenshot when available. Read the authoritative
`docs/design/design-system-baseline.html` and
`docs/design/governance-checklist.md`, plus relevant feature-specific decisions.
List the relevant loading, empty, error, partial-coverage, and unavailable
states.

When a substantial layout or interaction decision is open, prefer a small,
disposable responsive preview outside application source. A screenshot, mockup,
or interactive preview from another tool can serve the same purpose. Show the
affected component and enough surrounding UI to assess it. Use illustrative
values with realistic text lengths and relevant partial or unavailable data.
Assess mobile and desktop separately. On mobile, check component height,
scrolling to the next content, repeated information, and the space taken by
persistent navigation.

Give `enyaq_design_guardian` the user's task, owning screen, current screenshot
when available, relevant states, and design references. For an open proposal,
ask for an independent recommendation before comparing it with the draft or
preview variants. Confirm the direction with the user when a material product
choice remains open. When the user has already approved a screenshot, preview,
or specification, use it as the implementation reference and ask the guardian
to check fidelity and flag material issues. A settled direction can proceed
without a separate preview or another approval round. The guardian reviews
only. The main agent owns implementation and acceptance.

Capture the direction in the design brief or task notes. Include the reference
or description, mobile and desktop layout decisions, behavior to preserve,
relevant density and accessibility constraints, and any remaining open choices.
Keep implementation and later refinements focused on the specific change.

If the existing screenshot or guardian is unavailable, continue using evidence
from the current UI and authoritative docs. Disclose the missing visual or
independent verification; do not invent observations or claim a review occurred.

Keep feature-specific decisions local. In Analytics, Summary shows total
session spend. Billing Providers emphasizes spend per provider for comparison
and labels its distribution as billed energy. With partial coverage, it labels
the distribution as known billed energy.

## After implementation

For substantial visual changes and reviews, inspect the rendered UI in light
and dark mode at representative mobile and desktop widths. Verify the active
color scheme in the browser and check the affected states for readability,
contrast, and visible controls. Record the theme and viewport for each check.
If a theme cannot be exercised, report it as unverified.

When the design brief contains an approved reference, compare the rendered UI
against it and report material differences.

Use both themes as evidence when asking the guardian to review the rendered UI.
Request a further guardian review when an unresolved question requires rendered
evidence. Distinguish browser checks from physical-device or assistive-technology
checks.
