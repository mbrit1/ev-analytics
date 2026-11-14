---
name: enyaq-ui
description: >
  Automatically use for substantial Enyaq Suite UI changes to information
  hierarchy, metrics, navigation, or interaction patterns, and for substantial
  visual UI design or review. Keep small text and style fixes lightweight.
---

# Enyaq Suite UI design workflow

## Before implementation

Identify the owning screen and the user's intent. For an existing screen,
capture or obtain a current screenshot when available. Read the authoritative
`docs/design/design-system-baseline.html` and
`docs/design/governance-checklist.md`, plus relevant feature-specific decisions.
List the relevant loading, empty, error, partial-coverage, and unavailable
states.

Prepare a brief stating the user's task, proposed content and actions, and
relevant states. Give `enyaq_design_guardian` the user's task, owning screen,
current screenshot when available, relevant states, and design references.
Ask for its own recommendation before comparing it with the draft. Record the
mobile and desktop hierarchy and any unresolved material product choices. The
guardian reviews only; the main agent owns implementation and acceptance.

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

Use both themes as evidence when asking the guardian to review the rendered UI.
Request a further guardian review when an unresolved question requires rendered
evidence. Distinguish browser checks from physical-device or assistive-technology
checks.
