# Tariff Version Management Design

## Summary
Add explicit tariff version-management workflows so users can handle permanent price changes and temporary promotions without manually maintaining multiple tariff records.

Required behavior:
- The overview shows one card per logical tariff.
- Card actions distinguish between editing descriptive details, permanent price changes, and temporary promotions.
- Permanent price changes create a future successor version.
- Temporary promotions create a bounded promotional period and automatically restore the previous pricing afterward.
- Charging sessions use the tariff version effective on the session date.
- The overview shows compact status badges such as `Promo until 31 Aug` and `Upcoming change on 15 May`.
- Deleting a tariff removes the complete logical tariff, including scheduled versions.

The overview remains summary-focused. Version history and scheduled changes belong in a secondary detail surface.

Upcoming version visibility inside the overview card is further defined in `docs/superpowers/specs/2026-06-15-tariff-list-version-visibility-design.md`.

## Problem Statement
The current tariff workflow edits one tariff record in place. That is suitable for descriptive corrections, but it does not represent future price changes or temporary promotions clearly.

The product already has the concepts needed to preserve historical prices: tariff validity periods and session price snapshots. What is missing is a user-facing workflow that:

1. schedules permanent price changes without overwriting history,
2. runs temporary promotions and restores previous pricing automatically,
3. presents related versions as one logical tariff,
4. applies the correct version when a charging session is entered for a particular date.

The workflow must preserve historical correctness, avoid manual version bookkeeping, and keep the default overview uncluttered.

## Scope
In scope:
- Logical tariff identity and overview grouping.
- Tariff card actions and overflow-menu behavior.
- Descriptive detail edits across a logical tariff.
- Permanent price-change scheduling.
- Temporary promotions with automatic restoration.
- Effective-date tariff selection for charging sessions.
- Status badges for active promotions and upcoming changes.
- Version-history presentation.
- Logical-tariff deletion semantics.
- Validation, conflicts, and user-facing error behavior.
- Behavioral acceptance and regression coverage.

Out of scope:
- Changing the charging-session pricing formula.
- Changing the session snapshot strategy.
- Bulk tariff operations.
- Multi-user conflict-resolution workflows.
- Importing or inferring prices from external providers.

## Goals
1. Let users schedule permanent price changes without overwriting tariff history.
2. Let users run temporary promotions without manually recreating the previous price.
3. Keep the overview centered on logical tariffs rather than individual versions.
4. Ensure sessions use the version effective on their session date.
5. Preserve historical session prices and labels.
6. Keep the card layout calm and summary-focused.

## Non-Goals
1. Turn the overview card into a full version timeline.
2. Expose version bookkeeping in the default list view.
3. Reprice historical charging sessions.
4. Allow arbitrary manipulation of individual version rows from the overview.
5. Introduce unrelated tariff or session model changes.

## Domain Semantics

### Logical tariff identity
A logical tariff is identified by:
- provider,
- normalized tariff name.

All versions that remain in tariff management with the same identity belong to one logical tariff.

Normalization ignores leading and trailing whitespace and letter case. An unnamed tariff remains a valid logical identity for its provider.

### Calendar-date validity
Tariff validity is based on calendar dates:
- a start date is the first day the version applies,
- a user-facing end date is the final day the version applies,
- the next version begins on the following calendar day.

For a permanent change, the effective date is the first day the new price applies.

For a promotion:
- the promotion start date is the first promotional day,
- the promotion end date is the final promotional day,
- regular pricing resumes on the following calendar day.

Date copy, badges, session pricing, and version-history labels must follow these same semantics.

### Effective version
For any calendar date, a logical tariff may have at most one effective version.

The current version is the version effective today. The next version is the nearest version whose start date is after today.

Version-management actions must not create overlaps or gaps in a previously continuous tariff history.

## Functional Requirements

### 1. Overview grouping
- The overview shows one card per logical tariff.
- Past, current, promotional, restored, and scheduled versions of the same logical tariff never appear as separate overview cards.
- The card displays the current effective prices.
- Scheduled versions are represented through status and detail information rather than additional cards.

### 2. Charging-session pricing
- In plan mode, users select a logical tariff rather than an individual stored version.
- The applicable version is determined from the charging session date.
- The session uses and snapshots the prices from that effective version.
- Changing the session date must update the applicable version and displayed rates.
- A future version must not affect a session dated before its effective date.
- A promotion applies only to sessions dated within the promotional period.
- A restored version applies beginning on the first day after the promotion ends.
- If no version applies on the selected session date, saving is blocked with a clear explanation.
- Existing session snapshots remain unchanged unless the user deliberately changes pricing identity according to the session-editing rules.

### 3. Card actions
- Keep `Edit` as the visible primary action.
- Place secondary actions in an overflow menu.
- The overflow menu contains:
  - `Edit details`
  - `Change price permanently`
  - `Run temporary promotion`
  - `Delete tariff`

### 4. Edit details
- `Edit details` is for provider, tariff name, affiliation, notes, and other non-pricing descriptive corrections.
- Pricing and validity dates are not changed through this action.
- Provider or tariff-name changes apply to the complete logical tariff so its version history remains grouped under one identity.
- Historical session snapshots retain their saved labels and prices.
- This action does not create a successor version.

### 5. Permanent price change
- `Change price permanently` schedules a successor instead of editing historical pricing.
- The user chooses the first day the new price applies.
- Pricing and fee fields are prefilled from the version effective immediately before that date.
- The previous version remains effective through the preceding calendar day.
- The successor remains effective until another change is scheduled.
- The operation is blocked when existing scheduled versions make the requested change ambiguous or conflicting.

### 6. Temporary promotion
- `Run temporary promotion` opens a focused promotion flow.
- Promotion start and end dates are required.
- Promotional pricing and fee fields are prefilled from the baseline version.
- The baseline is the version that would otherwise apply on the promotion start date.
- The promotion applies from its start date through its end date, inclusive.
- The baseline pricing resumes automatically on the following calendar day.
- The operation is presented and completed as one user action.
- The operation is blocked when an existing scheduled change conflicts with the promotional period or automatic restoration.

### 7. Overview upcoming visibility
- Each card keeps the current effective prices as the primary information.
- Active promotions may still show a compact `Promo until <date>` badge using the final promotional day.
- Upcoming non-promotional versions use the companion visibility model in `docs/superpowers/specs/2026-06-15-tariff-list-version-visibility-design.md`.
- Only the nearest upcoming version affects overview-card visibility.
- The overview card may show:
  1. no upcoming-change UI when the next change is too far away,
  2. a compact indicator when the next change is approaching,
  3. a compact preview of only the changed price categories when the next change is imminent.
- The overview card must not become a full inline history timeline.

### 8. Version-history detail
- A secondary detail surface presents the complete version history for the logical tariff.
- It shows current, past, scheduled, promotional, and restored versions.
- Versions are ordered chronologically by their first effective day.
- Contextual labels include:
  - `Current`
  - `Scheduled`
  - `Promotion`
  - `Past`
  - `Restored`
- Each row shows its effective date range and relevant prices and fees.
- The detail surface makes promotion restoration visible without presenting it as a separate logical tariff.

### 9. Delete tariff
- `Delete tariff` applies to the complete logical tariff, not only the current version.
- Deletion removes all past, current, promotional, restored, and scheduled versions from tariff management and future session selection.
- Scheduled changes and automatic restorations cannot reactivate a deleted tariff.
- Historical charging sessions retain their saved tariff labels, prices, and calculated costs.
- The confirmation message explains that the complete tariff history and all scheduled changes will be removed from tariff management.

## Promotion Classification
A bounded version is classified as a promotion only when:
- it has a preceding baseline version,
- a successor begins on the first day after the promotional period,
- the successor restores the baseline price structure.

The price structure consists of:
- domestic AC price,
- domestic DC price,
- roaming AC price,
- roaming DC price,
- monthly base fee,
- session fee.

Optional values must match as absent or present with the same value. Provider, tariff name, affiliation, and notes do not determine whether pricing was restored.

If these conditions are not met, the bounded version is presented as an ordinary past, current, or scheduled version rather than a promotion.

## UX Design

### Overview card
The overview card focuses on:
- provider name,
- optional tariff variant name,
- current effective AC and DC prices,
- one compact status badge,
- visible `Edit` action,
- overflow menu for secondary actions.

The card does not show an inline timeline or multiple status lines.

### Permanent change form
- Title: `Change price permanently`
- Prefill pricing and fees from the applicable baseline.
- Ask for the effective date of the new price.
- Explain that existing history remains unchanged and the new price begins on the selected date.

### Promotion form
- Title: `Run temporary promotion`
- Ask for the first and final promotional days.
- Prefill promotional pricing and fees from the applicable baseline.
- Explain that the previous pricing resumes on the day after the promotion ends.

Suggested helper text:

`This creates a temporary price and restores the previous price on the day after the promotion ends.`

### Delete confirmation
The confirmation must identify the logical tariff and state that all scheduled changes and promotions will also be removed. It must also reassure the user that historical charging-session records will not be repriced.

## Validation And Error Handling

### Shared validation
- Required dates must be present.
- Effective periods must be unambiguous and non-overlapping.
- User-entered money values must be valid non-negative amounts.
- Failed submissions keep all user-entered values.
- Errors use user-facing tariff and date language.

### Permanent change validation
- The effective date must be after the first effective day of the baseline version.
- The requested change must preserve a continuous version history.
- Existing scheduled versions must not be silently replaced or reordered.
- Conflicts block submission and identify the conflicting scheduled date.

### Promotion validation
- The start and end dates are required.
- The end date must be on or after the start date.
- A baseline version must apply on the start date.
- The promotional period and automatic restoration must preserve a continuous version history.
- Existing scheduled versions must not be silently replaced, shortened, or reordered.
- Conflicts block submission and identify the conflicting scheduled date.

## Consistency Requirements
- A permanent change or promotion is either fully visible as a coherent version history or not applied.
- Users must not observe a partial promotion without its restoration.
- Local and synchronized views must converge on the same logical tariff history.
- Conflict handling must preserve the user's local data and explain what requires attention.
- Historical charging sessions must remain stable when tariff versions are edited, scheduled, promoted, restored, or deleted.

## Acceptance Criteria

### Logical grouping
- Multiple versions of one logical tariff render as one overview card.
- Identity changes keep all versions grouped together.
- The detail surface shows the complete chronological history.

### Permanent changes
- A session before the change date uses the previous price.
- A session on or after the change date uses the successor price.
- The overview shows the future change before it becomes effective.
- Conflicting scheduled changes are rejected without altering the existing history.

### Promotions
- A session before the promotion uses baseline pricing.
- A session on the first or final promotional day uses promotional pricing.
- A session on the following day uses restored baseline pricing.
- An active promotion shows `Promo until <final promotional day>`.
- A conflicting scheduled change prevents promotion creation without altering the existing history.

### Editing and deletion
- Editing provider or tariff name preserves one logical version history.
- Editing descriptive details does not alter prices or validity dates.
- Deleting a logical tariff removes every version and scheduled change from tariff management and session selection.
- Existing session snapshots remain unchanged after edits or deletion.

### Regression coverage
- Creating a new tariff still works.
- Existing descriptive edit behavior remains available through `Edit details`.
- Session pricing remains historically stable.
- Offline use supports all version-management actions without requiring connectivity.

## Risks And Decisions
- Logical identity remains provider plus normalized tariff name. Identity edits therefore apply to the complete version history.
- Delete means deleting the complete logical tariff. Individual version deletion is not part of this design.
- Promotion end dates are inclusive in user-facing language. Regular pricing resumes the following day.
- Promotion classification is derived from version relationships and exact restoration of pricing fields.
- If future product requirements allow arbitrary version editing, explicit promotion metadata may become necessary. That is not required for this scope.

## Recommendation
Deliver the workflow as one coherent tariff-management capability:

1. logical overview grouping,
2. effective-date session pricing,
3. descriptive detail editing,
4. permanent price scheduling,
5. temporary promotion scheduling and restoration,
6. version-history detail,
7. logical-tariff deletion.
