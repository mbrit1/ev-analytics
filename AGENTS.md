# Coding Agent Instructions

These instructions apply to the entire repository. Human contributors should start with `README.md` and `CONTRIBUTING.md`. Implemented technical behavior is documented in `docs/architecture.md`; infrastructure procedures are in `docs/infrastructure-runbook.md`.

## Repository Map

- `src/app/`: application composition, shell, and providers
- `src/features/`: domain code for `analytics`, `auth`, `charging-plans`, `charging-sessions`, and `offline-sync`
- `src/shared/ui/`: domain-agnostic UI primitives
- `src/shared/lib/`: pure shared helpers without infrastructure dependencies
- `src/infra/`: database, Supabase, and mock adapters
- `src/test/` and `src/mocks/`: shared test and mock infrastructure
- `supabase/`: canonical remote schema and development seed data
- `docs/adr/`: architecture decisions
- `docs/design/`: current UI design-system baseline and review checklist

## Non-Negotiable Rules

- Data creation and editing must remain available offline. Persist local writes through Dexie and the outbox before later Supabase synchronization.
- Supabase must remain private, authenticated, single-user, and protected by default-deny RLS.
- Store money as integer cents, render EUR with European decimal formatting, store dates in UTC, and preserve pricing snapshots on charging sessions.
- Treat missing optional measurements such as odometer, SoC, and energy values as unavailable, never as zero.
- Keep data-entry UI usable one-handed and without connectivity: use appropriate mobile input modes and maintain at least 44px touch targets.
- `features` may depend on `shared` and approved `infra` interfaces. `shared` and `infra` must not import from `features`.
- Cross-feature imports must use `src/features/<domain>/index.ts`, never another feature's internal path.
- Significant architecture changes require an ADR.
- Never commit secrets. Local Supabase credentials belong only in `.env.local`.

## Working Rules

- Inspect the worktree before editing. Preserve existing user changes and avoid unrelated cleanup.
- Work on a semantic feature branch such as `feat/...`, `fix/...`, or `docs/...`. Never commit on `main`; if work starts there, branch before editing.
- Keep changes small and scoped. For structural refactors, move first without changing behavior, then make behavioral changes separately with targeted tests.
- Do not push, open a pull request, or merge without explicit human authorization.
- Follow the current design baseline in `docs/design/design-system-baseline.html` and the checklist in `docs/design/governance-checklist.md` for UI work.

## Implementation Conventions

- Use strict TypeScript and React function components. Prefer feature-local code before extracting shared abstractions.
- Name components `PascalCase.tsx`, hooks `useName.ts`, services `nameService.ts`, and tests `*.test.ts(x)`.
- Add concise JSDoc to exported interfaces, props types, and components. Comments should explain intent or constraints, not restate types.
- Do not add emojis to source, comments, or configuration unless they are intentionally rendered in the UI.
- Keep tests beside covered code. Add a suite-level JSDoc block above the main `describe` and use `// Arrange`, `// Act`, and `// Assert` comments inside tests.
- Cover changed domain behavior and user workflows. Sync and mutation work must cover offline behavior, idempotency, retry and partial-failure state, authentication boundaries, reconnect races, and pricing snapshots where relevant.

## Verification

- During implementation, run the narrowest relevant tests and checks.
- Before proposing a push or pull request, run:

  ```bash
  npm run lint && npm run test -- --run && npm run build
  ```

- For documentation-only changes, run `npm run docs:check` and `git diff --check`; application tests are not required unless documentation tooling or executable examples changed.
- For performance-sensitive changes, including new dependencies, major UI additions, or bundling/runtime changes, also run `npm run build:analyze` and report notable bundle deltas or top chunk drivers.
- For UI changes, verify affected mobile and desktop layouts and include screenshots in the pull request.
- For project-structure changes, run lint, tests, and build, then report moved paths and boundary impact.

## Handoff

Summarize changed files, verification performed, remaining risks, and a suggested Conventional Commit message. Note UI design deviations as either `local exception` or `promote to master`.

See `CONTRIBUTING.md` for the full human workflow, `docs/architecture.md` for implemented behavior, and `docs/adr/` for the decisions behind these constraints.
