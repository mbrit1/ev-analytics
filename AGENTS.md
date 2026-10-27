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
- Never publish local usernames, home directories, absolute machine paths, worktree or temporary paths, or private evidence locations to GitHub. Repository-relative paths are allowed. Omit references to private screenshots or local evidence reports from GitHub text.

## Working Rules

- Inspect the worktree before editing. Preserve existing user changes and avoid unrelated cleanup.
- Work on a semantic feature branch such as `feat/...`, `fix/...`, or `docs/...`. Never commit on `main`; if work starts there, branch before editing.
- Do not commit, push, open a pull request, or merge without explicit human authorization.
- Before every GitHub text write, run `npm run --silent github:check` on the exact prepared title/body/comment files or stdin. Before pushing, scan every outgoing commit message with `--commits BASE..HEAD`, using the verified publication base. Chain validation and publication with `&&`; a nonzero result blocks the write. Revalidate any edited text, including corrective writes. Do not bypass the gate with a connector or raw `gh` call. After publication, read back the remote text, validate it and compare it with the prepared content before reporting success. See [GitHub publication privacy](CONTRIBUTING.md#github-publication-privacy) for usage and limits.
- Keep changes small and scoped. For structural refactors, move first without changing behavior, then make behavioral changes separately with targeted tests.
- Follow the current design baseline in `docs/design/design-system-baseline.html` and the checklist in `docs/design/governance-checklist.md` for UI work.

## Review and Behavioral Evidence

- Review the complete diff and run integration-level validation before handoff.
- When sharing work, establish non-overlapping file ownership and preserve others' changes. Resolve scope, architecture, product, and security decisions before implementation; return unresolved decisions to the responsible maintainer.
- For delegated domain, security, sync, persistence, migration, transaction, or concurrency behavior, pause after RED evidence for acknowledgement by the coordinating reviewer before implementation. Other non-trivial delegated behavioral changes also require this checkpoint; small, localized, low-risk work may report RED and GREEN together.
- RED evidence must include the exact command and expected failing behavior. The reviewer may rely on that evidence unless ambiguous, inconsistent, or invalidated by worktree changes. Final integration validation remains mandatory.
- TypeScript implementation slices must run `npm run typecheck` before GREEN.
- One-file presentational or mechanical changes use focused checks and live-browser validation where applicable; do not add brittle unit tests solely to prove CSS classes.
- UI integration validation includes live-browser visual review; component tests alone do not complete handoff.
- Delegated contributors must stop at their assigned scope and report changed files, exact validation commands and results, blockers, and residual risks. They must not publish or finalize independently.

## Implementation Conventions

- Use strict TypeScript and React function components. Prefer feature-local code before extracting shared abstractions.
- Name components `PascalCase.tsx`, hooks `useName.ts`, services `nameService.ts`, and tests `*.test.ts(x)`.
- Add concise JSDoc to exported interfaces, props types, and components. Comments should explain intent or constraints, not restate types.
- Do not add emojis to source, comments, or configuration unless they are intentionally rendered in the UI.
- Keep tests beside covered code. Add a suite-level JSDoc block above the main `describe` and use `// Arrange`, `// Act`, and `// Assert` comments inside tests.
- Cover changed domain behavior and user workflows. Sync and mutation work must cover offline behavior, idempotency, retry and partial-failure state, authentication boundaries, reconnect races, and pricing snapshots where relevant.

## Browser Validation

- Use available browser tooling for local preview, visual and responsive checks, screenshots, console inspection, DOM/style inspection, network inspection, and keyboard/focus checks.
- Use developer tools/CDP when deeper inspection is needed.
- Do not install or download Playwright, Puppeteer, Chromium, Chrome, browser drivers, or browser-automation dependencies for ad-hoc validation.
- Adding or modifying browser-testing dependencies, or using or installing an alternative when the available browser tooling is blocked, requires explicit human approval.
- An E2E suite is allowed only when it is explicitly approved, repository-owned, uses a pinned project dev dependency, and is documented and reproducible in CI; never install it globally.

## Verification

- During implementation, run the narrowest relevant tests and checks.
- Before proposing a push or pull request, run:

  ```bash
  npm run lint && npm run test -- --run && npm run build
  ```

- For documentation-only changes, run `npm run docs:check` and `git diff --check`; application tests are not required unless documentation tooling or executable examples changed.
- For performance-sensitive changes, including new dependencies, major UI additions, or bundling/runtime changes, also run `npm run build:analyze` and report notable bundle deltas or top chunk drivers.
- For UI changes, verify affected mobile and desktop layouts. Publish only 1–3 representative, sanitized screenshots of the final change when they help reviewers, preferably as a compact comparison. Omit the UI-evidence section when no screenshot is attached; report browser checks and validation gaps under Verification. Keep intermediate, duplicate and routine test captures out of GitHub, and avoid duplicating PR screenshots in the linked issue. See [UI and Design Governance](CONTRIBUTING.md#ui-and-design-governance).
- For project-structure changes, run lint, tests, and build, then report moved paths and boundary impact.

## Handoff

Summarize changed files, verification performed, remaining risks, and a suggested Conventional Commit message. Note UI design deviations as either `local exception` or `promote to master`.

See `CONTRIBUTING.md` for the full human workflow, `docs/architecture.md` for implemented behavior, and `docs/adr/` for the decisions behind these constraints.
