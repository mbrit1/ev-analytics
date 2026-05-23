# Session Mode Hard Cutover Design

## Summary
Perform a hard cutover from legacy session pricing semantics to a strict two-mode model:
- `sessionMode = plan`
- `sessionMode = adHoc`

`Ad-Hoc` remains an explicit exception path and must not be represented as a tariff/plan contract relationship.

Production currently has no data, so we can perform schema-level breaking changes without backward-data migration complexity.

## Locked Domain Model

```ts
type SessionMode = 'plan' | 'adHoc';

type PriceSnapshot = {
  label: string;      // "EnBW L" or "Ad-Hoc"
  kWhPrice: number;   // integer cents
  sessionFee?: number;
  blockingFee?: number;
};

type ChargingSession = {
  providerId: string;
  sessionMode: SessionMode;
  tariffPlanId?: string;
  priceSnapshot: PriceSnapshot;
  chargedAt: Date;
};
```

Supporting entities:

```ts
type Provider = {
  id: string;
  name: string;
};

type TariffPlan = {
  id: string;
  providerId: string;
  name: string;
  isSinglePlanDefault?: boolean;
};

type ProviderPlanSelection = {
  id: string;
  providerId: string;
  tariffPlanId: string;
  validFrom: Date;
  validTo?: Date | null;
  priceSnapshot: TariffPriceSnapshot;
};
```

## Invariants (Authoritative Rules)

1. `providerId` is always required.
2. If `sessionMode === 'plan'`:
- `tariffPlanId` is required.
- `priceSnapshot` is derived from selected plan pricing and stored as immutable snapshot.
3. If `sessionMode === 'adHoc'`:
- `tariffPlanId` is forbidden.
- `priceSnapshot` is required and user-provided (one-off public pricing evidence).
4. Provider may exist without selected plan only in catalog/admin state.
5. Usage/logging state must always resolve to either:
- contract-backed provider+plan, or
- provider + ad-hoc snapshot (no plan link).
6. `ProviderPlanSelection` rows are append-only history periods with unique IDs. Returning to the same `tariffPlanId` later creates a new row; it must not mutate an older period.

## Plan Selection History Semantics

`ProviderPlanSelection` tracks active contract windows, not mutable overwrites. It is a history entity separate from reusable `TariffPlan` catalog records.

Example:
- `selection_001`: EnBW L, `validFrom = 2026-01-01`, `validTo = 2026-05-28`, snapshot = L prices at that time
- `selection_002`: EnBW M, `validFrom = 2026-05-28`, `validTo = 2026-08-10`, snapshot = M prices at that time
- `selection_003`: EnBW L, `validFrom = 2026-08-10`, `validTo = null`, snapshot = new L prices

Behavior:
- Switching active plan closes the previous row (`validTo = switch timestamp`) and creates a new open row.
- Overlapping active windows for the same provider are invalid.
- A new row always gets a new `id` even when `tariffPlanId` equals a previously used plan.

## Hard Cutover Scope

Replace legacy semantics across domain, form, service, DB, and sync layers in one release:
- Remove `pricing_source` from session model.
- Remove legacy compatibility branches that map `tariff_id`/`charging_plan_id` variants.
- Canonical session fields become `session_mode`, `tariff_plan_id`, and `plan_selection_id` (DB snake_case).
- Canonical domain naming uses `tariffPlanId` and `sessionMode`.

Because production has no persisted rows, no user-data backfill logic is required.

## UX and Interaction Design

### Session Form: Plan Mode
- Provider is required.
- Tariff plan is required.
- Plan options are filtered by provider.
- If provider has exactly one plan, auto-select it.
- If provider has no plans, plan select remains disabled and save is blocked with field error.

### Session Form: Ad-Hoc Mode
- Provider is required.
- Plan selection is hidden or disabled and cleared.
- Snapshot pricing inputs are required to build `priceSnapshot`.
- Save is blocked unless snapshot requirements are satisfied.

### Mode Switching Rules
- Switching to `adHoc` clears `tariffPlanId` immediately.
- Switching to `plan` clears ad-hoc-only payload from submission path.
- Field-level validation messages must be rendered (no silent submit returns).

### Display Semantics
- Session history/detail renders stored snapshot label (`"EnBW L"` or `"Ad-Hoc"`), not current provider/plan state, to preserve historical correctness.
- Plan-mode sessions resolve contract identity through `planSelectionId`, so `L -> M -> L` remains historically distinct per period.

## Session Linkage Semantics

For `sessionMode = plan`, sessions must reference the selected history period row:

```ts
type ChargingSession = {
  providerId: string;
  sessionMode: 'plan' | 'adHoc';
  tariffPlanId?: string;
  planSelectionId?: string;
  priceSnapshot: PriceSnapshot;
  chargedAt: Date;
};
```

Plan mode requirements:
- `providerId` required
- `tariffPlanId` required
- `planSelectionId` required
- `priceSnapshot` required and persisted

Ad-hoc mode requirements:
- `providerId` required
- `tariffPlanId` forbidden
- `planSelectionId` forbidden
- `priceSnapshot` required

## Persistence and Sync Design

### Dexie
- Bump DB version.
- Session table schema includes `session_mode`, `tariff_plan_id`, `plan_selection_id`, and snapshot fields.
- Add `provider_plan_selections` table.
- Remove deprecated legacy indexes/fields tied to pre-cutover semantics.

### Supabase
- Add matching schema for `provider_plan_selections`.
- Update `charging_sessions` columns to canonical cutover fields.
- Add DB constraints/checks for invariants:
  - `session_mode = 'plan'` requires `tariff_plan_id IS NOT NULL` and `plan_selection_id IS NOT NULL`.
  - `session_mode = 'adHoc'` requires `tariff_plan_id IS NULL`, `plan_selection_id IS NULL`, and snapshot payload present.
  - `plan_selection_id` must reference a `provider_plan_selections.id` row with matching `provider_id` and `tariff_plan_id`.
- Preserve default-deny RLS and authenticated single-user policy posture.

### Sync Engine
- Extend outbox union/table_name support to include `provider_plan_selections`.
- Ensure hydration order can resolve plan selections before dependent UX reads.
- Align payload serialization with canonical cutover names and invariants.

## Error Handling

- Validation failures are surfaced as field errors in forms and explicit exceptions in domain service boundaries.
- Illegal state transitions (e.g., persisting `adHoc` with `tariffPlanId` or `planSelectionId`) are rejected in service logic even if UI checks fail.
- Plan-selection history writes must reject overlaps for same provider.

## Testing Strategy

### Unit / Service Tests
- `plan` mode requires provider + tariffPlanId.
- `plan` mode requires provider + tariffPlanId + planSelectionId.
- `adHoc` mode forbids tariffPlanId/planSelectionId and requires priceSnapshot.
- Snapshot immutability preserved after session write.
- Provider-plan switch closes old selection and opens new window.
- Re-selecting an older plan creates a new `ProviderPlanSelection` row with a new `id` and fresh snapshot.

### UI Tests
- Plan mode provider/plan dependency and no-plan provider guard.
- Single-plan auto-select behavior.
- Ad-hoc mode required snapshot field validation.
- Mode-switch clearing rules.

### Sync / DB Tests
- Outbox includes `provider_plan_selections` items.
- DB constraints reject invalid mode/plan combinations.
- Initial sync/hydration handles new table.

### Verification Commands
- `npm run lint`
- `npm run test -- --run`
- `npm run build`
- `npm run build:analyze`

## Risks and Mitigations

1. Naming churn risk (`chargingPlan` vs `tariffPlan` vocabulary drift).
- Mitigation: enforce canonical type/field names in domain layer and map once at boundaries.

2. Regression risk in existing ad-hoc path.
- Mitigation: explicit invariant tests for ad-hoc forbidden plan linkage and required snapshot.

3. Historical resolution ambiguity if selection windows overlap.
- Mitigation: enforce non-overlap in write service and DB constraints.

4. Broken historical traceability if sessions only store `tariffPlanId`.
- Mitigation: make `planSelectionId` mandatory for plan-mode sessions and enforce FK consistency checks.

## Out of Scope

- Multi-user shared-provider collaboration.
- Dynamic tariff inference from external APIs at session time.
- Backward compatibility adapters for legacy production data.
