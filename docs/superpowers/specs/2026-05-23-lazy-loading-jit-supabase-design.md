# Lazy Loading + JIT Supabase + Targeted Form Splitting (Design)

Date: 2026-05-23
Status: Drafted for implementation

## Context

The repository already contains:
- layer refactor + boundary guardrails,
- `build:analyze` + visualizer,
- MSW removed from production bundle,
- AGENTS.md guidance for performance verification.

This design adds incremental runtime-loading improvements without regressing the core user journeys.

## Goals

1. Reduce initial bundle impact by deferring rare flows.
2. Keep login + session main path fast and behaviorally unchanged.
3. Preserve offline-first guarantees (local writes never require connectivity).
4. Keep changes small and commit-friendly by theme.

## Non-Goals

1. No new Analytics view implementation.
2. No placeholder entry-point for Analytics in this round.
3. No broad lazy-splitting of session core flows.

## Scope Decisions

1. Tariff overview is rare and will be lazy-loaded at app level.
2. Session paths remain eager-loaded to avoid core UX regressions.
3. Optional idle prefetch is enabled only for tariff view after authenticated app load.
4. Supabase usage is reviewed and shifted to just-in-time initialization for non-critical sync/realtime-adjacent work, while auth/offline guarantees remain intact.
5. `react-hook-form` + `zod` splitting is targeted to tariff form flows; session form path is not degraded.

## Architecture and Loading Strategy

## A) Feature Lazy Loading in App

- Use `React.lazy` + `Suspense` in `src/app/App.tsx` for tariff view only.
- Dynamic import must target the concrete module path (for effective chunk splitting), not an all-in barrel export.
- `sessions` tab branch stays eager and unchanged.
- Add optional `requestIdleCallback` prefetch after authenticated shell is available; fallback to a short timeout when unsupported.

Expected outcome:
- Lower initial app chunk pressure.
- First tariff navigation may incur a one-time chunk fetch unless idle-prefetched.

## B) Supabase “Just in Time”

- Keep login and session-start path responsive.
- Move non-critical sync engine/supabase-heavy initialization behind authenticated runtime startup.
- Ensure runtime still processes outbox + hydration correctly once initialized.
- Keep Dexie/local services authoritative for create/edit so offline-first remains intact.

Expected outcome:
- Less early Supabase-related code on critical initial path.
- No change to offline mutation semantics.

## C) Targeted `react-hook-form` + `zod` Splitting

- Apply lazy split to tariff form flow (rare interaction).
- Do not apply to main session form path in this round.
- Keep form behavior and validation parity.

Trade-offs:
- Pro: lower initial JS for users who never open tariff form.
- Con: first tariff-form open may include small load delay.
- Mitigation: keep tariff view prefetch option in app after login.

## Import Boundary and Chunking Rules

- Respect existing AGENTS.md boundary rules.
- Avoid deep cross-feature imports except allowed `features/<domain>/index.ts` contract usage.
- For chunk splitting, dynamic imports may target concrete component modules inside the same feature domain to avoid pulling unrelated exports.

## Test Strategy

- Update/add tests around app auth gating + lazy tariff rendering behavior.
- Update/add sync runtime tests for deferred/JIT initialization semantics.
- Update/add tariff form tests to verify lazy-loaded flow behavior parity.
- Ensure existing offline sync and auth tests remain green.

## Verification Plan

Run:

```bash
npm run lint
npm run test -- --run
npm run build
npm run build:analyze
```

Capture in handoff:
- whether tariffs/form libs moved to separate chunks,
- notable chunk-size deltas from previous baseline,
- confirmation that session core path was not functionally regressed.

## Commit Plan (Small and Thematic)

1. `perf(app): lazy load tariff view with idle prefetch`
- App shell lazy wiring + focused app test updates.

2. `perf(sync): defer supabase-heavy sync initialization`
- JIT runtime/sync loading + runtime test updates.

3. `perf(tariffs): lazy split tariff form validation stack`
- Tariff form path split + related tests.

4. `chore(perf): verify bundle analysis and document deltas`
- If needed, include small docs note with key build-analyze findings.

## Risks and Mitigations

1. Risk: ineffective chunk splitting due to barrel import coupling.
- Mitigation: dynamic import concrete module paths; verify build output.

2. Risk: delayed first interaction in tariff path.
- Mitigation: idle prefetch after auth; lightweight suspense fallback.

3. Risk: sync timing changes after JIT loading.
- Mitigation: keep runtime trigger semantics and add focused tests for startup/online/outbox triggers.

4. Risk: accidental regression of offline-first behavior.
- Mitigation: no change to local-write services; preserve outbox contract; run full tests.

## Open Questions Resolved

1. Analytics view lazy-loading in this round: out of scope.
2. Analytics lazy-loading prep hook/entry-point: explicitly out of scope.
