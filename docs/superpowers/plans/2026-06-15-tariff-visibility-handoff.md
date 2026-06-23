# Tariff Visibility Refactor Handoff

## Current Decision
- Amend `docs/superpowers/specs/2026-06-12-tariff-version-management-design.md`.
- Do not create a new standalone spec file for this update.

## Why This Is An Amendment
- The existing tariff version management spec already owns overview-card behavior, upcoming change messaging, and the secondary history surface.
- The requested update refines that same behavior into a more explicit 3-state visibility model rather than introducing a separate feature area.
- The current implementation gap is concentrated in the logical-tariff list model and card rendering, which supports amending the existing spec instead of branching into a new design track.

## Recommended Spec Changes
Amend the June 12 tariff version management spec to:

1. Replace the current badge-only upcoming-change rule with a 3-state upcoming visibility model:
   - `none` when the next change is more than 30 days away
   - `indicator` when the next change is 8 to 30 days away
   - `preview` when the next change is 0 to 7 days away
2. Make the day-window semantics explicit in UTC calendar days to avoid off-by-one behavior.
3. Clarify that only the nearest upcoming version drives list visibility.
4. Keep version awareness attached to the individual tariff card.
5. Treat full version history as a secondary surface, not the primary upcoming-change treatment.
6. Show only changed price categories in the preview state.
7. Preserve the current compact card height when no upcoming UI is visible.
8. Keep future prices visually calm, without special highlighting of changed values.

## Current Implementation Gaps
- `src/features/charging-plans/model/logicalTariffs.ts`
  - Currently exposes `badge`, `nextVersion`, and `history`.
  - Likely needs a richer upcoming-visibility model and changed-category diffing.
- `src/features/charging-plans/components/TariffList.tsx`
  - Currently renders the current prices, an optional badge, and a separate history action.
  - Does not implement indicator vs preview behavior inside the card body.

## Likely Implementation Files
- `src/features/charging-plans/model/logicalTariffs.ts`
- `src/features/charging-plans/model/logicalTariffs.test.ts`
- `src/features/charging-plans/components/TariffList.tsx`
- `src/features/charging-plans/components/TariffList.test.tsx`
- `src/features/charging-plans/hooks/useChargingPlans.ts` if the logical tariff shape changes
- `src/features/charging-plans/components/TariffVersionHistorySheet.tsx` only if shared helpers or copy need alignment

## Risks And Edge Cases
- UTC day-boundary off-by-one behavior around midnight and inclusive threshold boundaries.
- Multiple future versions: confirm that the nearest upcoming version is the only driver for list visibility.
- Changed-category diff rules need to define how `undefined`, `0`, and optional fees behave.
- `PRICE_STRUCTURE_KEYS` in `logicalTariffs.ts` currently includes `affiliation`, which conflicts with the design rule that non-price metadata should not determine restoration semantics.
- UI changes must avoid leaving empty spacing or alignment drift when no upcoming section is rendered.
- There is no current standalone history card above the tariff list; the existing pattern to revisit is the per-card `View history` action.

## Suggested Next Steps
1. Amend `docs/superpowers/specs/2026-06-12-tariff-version-management-design.md` with the visibility refinement.
2. Self-review the amended spec for contradictions, placeholders, and ambiguous threshold wording.
3. Ask for approval before moving from spec work into planning and implementation.

## Suggested Commit Message For Follow-Up Work
- `docs(tariffs): amend version-management spec for 3-state upcoming visibility`
