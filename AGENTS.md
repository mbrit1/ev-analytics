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

Trivial-task exemption: short read-only work answerable through one bounded
inspection and bounded documentation-only changes across at most three files
without executable content or architecture, product, security, or policy
decisions stay with the primary supervisor and require neither routing
calculation nor delegation.
Batch known adjacent documentation edits into one slice and one validation pass
instead of creating separate worker handoffs for each file or follow-up.
Substantial, repetitive, or independently parallelizable read-only investigation
is non-trivial and follows the routing gate. The routing gate below applies to
all non-trivial work.

## Agent Responsibilities

- `implement_luna` handles localized implementation, refactoring, unit tests, mechanical changes, and conflict-free Git history maintenance with an exact approved plan.
- `implement_terra` handles debugging, integrations, cross-module changes, Git history conflicts or recovery, and escalations from Luna.
- `implement_sol` handles bounded score 7+ implementation after the primary supervisor resolves any architecture, product, security, or routing decision.
- The top-level user-facing agent is the primary supervisor regardless of whether its active model is Luna, Terra, or Sol. The primary supervisor is responsible for:
  - Creating the implementation plan and making architecture decisions.
  - Calculating and reporting the routing score defined in `.codex/config.toml` as one compact line containing only non-zero factors before non-trivial implementation.
  - Using the calculated execution tier by default and reporting any permitted override reason.
  - Ensuring workers have no overlapping file ownership.
  - Reviewing every completed diff.
  - Running integration-level validation.
  - Presenting the final result and making merge decisions.
- The routing gate applies even when delegation is unavailable, prohibited, unnecessary, or overridden. Do not begin non-trivial implementation until the compact factor list, total, calculated route, actual route, and override reason are reported.
- The primary supervisor is the sole routing authority. Workers report only changed files, each exact validation command and result, and any blocker or residual risk; do not restate route, task, or prior evidence unless asked.
- Recalculate an independently discovered fix only when its likely route threshold or owned scope materially differs from the active slice. Clear corrections with unchanged scope stay with the current owner.
- Route scores 0-2 to Luna, 3-6 to Terra, and 7+ to Sol. Treat the calculated route as the target execution tier. When it matches the primary supervisor's active model, execute locally; otherwise delegate to `implement_luna`, `implement_terra`, or `implement_sol` unless the user prohibits delegation, the required agent or tooling is unavailable, the slice changes routing authority or worker permissions, the task meets the trivial-task exemption, or the primary supervisor must first resolve an architecture, product, or security decision.
- A small diff, routine handoff, or higher raw token count alone is not a sufficient override. For any other override, report concrete evidence that local execution has the lower total expected cost after price-weighted model usage, worker context setup, handoff and review overhead, latency, duplicate validation, and error or rework risk are considered; absent that evidence, use the calculated execution tier. Prefer reusing an active compatible worker or batching adjacent work when that amortizes the handoff cost.
- Give focused workers bounded prompts with `fork_turns: "none"` unless the task genuinely requires surrounding conversation context; include the necessary context explicitly in the assignment.
- Delegation depth is exactly one: primary supervisor to leaf worker. Every created worker is a leaf and must not create agents, delegate, fork tasks, recalculate routing, or approve escalation. At most two workers may be active concurrently, only for independent slices with non-overlapping ownership.
- A worker that cannot finish must stop and return an escalation request with evidence to the primary supervisor. Escalation for the same slice is monotonic from Luna to Terra to Sol and never moves downward.
- A Sol worker that cannot finish returns the slice to the primary supervisor for a local decision or user input. Do not create another worker for unchanged scope.
- Only one agent may own a slice at a time. Before replacing a worker, the primary supervisor inspects the shared worktree, revokes the previous ownership, and establishes the replacement's starting diff.
- Delegate Git history maintenance only after the parent defines the source and target refs, exact rewrite plan, recovery ref, expected final tree, and validation commands. Luna may execute a conflict-free plan; conflicts, ambiguous commit ownership, unexpected tree differences, and recovery needs escalate to Terra.
- For explicitly authorized history maintenance, Luna, Terra, and Sol workers may create rewritten commits but must not publish them. The primary supervisor reviews the final graph and tree and retains responsibility for push, pull-request, merge, and finalization decisions.
- Test-driven delegated changes require a RED pause and parent acknowledgement for score 3+ work and for domain, security, sync, persistence, migration, transaction, or concurrency behavior. For score 0-2 work, Luna may report RED and GREEN together. TypeScript implementation slices must run `npm run typecheck` before GREEN.
- Parent acknowledgement may rely on the subagent's exact RED command and failure evidence. Re-run RED only when that evidence is ambiguous or inconsistent, or when shared worktree state changed; final integration validation remains mandatory.
- One-file presentational or mechanical changes use focused checks and live-browser validation where applicable; do not add brittle unit tests solely to prove CSS classes.
- UI integration validation includes live-browser visual review; component tests alone do not complete handoff.
- Workers do not merge or finalize work independently.

## Implementation Conventions

- Use strict TypeScript and React function components. Prefer feature-local code before extracting shared abstractions.
- Name components `PascalCase.tsx`, hooks `useName.ts`, services `nameService.ts`, and tests `*.test.ts(x)`.
- Add concise JSDoc to exported interfaces, props types, and components. Comments should explain intent or constraints, not restate types.
- Do not add emojis to source, comments, or configuration unless they are intentionally rendered in the UI.
- Keep tests beside covered code. Add a suite-level JSDoc block above the main `describe` and use `// Arrange`, `// Act`, and `// Assert` comments inside tests.
- Cover changed domain behavior and user workflows. Sync and mutation work must cover offline behavior, idempotency, retry and partial-failure state, authentication boundaries, reconnect races, and pricing snapshots where relevant.

## Browser Validation

- Use the built-in Codex Browser by default for local preview, visual and responsive checks, screenshots, console inspection, DOM/style inspection, network inspection, and keyboard/focus checks.
- Use Browser Developer mode/CDP when deeper inspection is needed.
- Do not install or download Playwright, Puppeteer, Chromium, Chrome, browser drivers, or browser-automation dependencies for ad-hoc validation.
- Adding or modifying browser-testing dependencies, or using or installing an alternative when Browser is blocked, requires explicit human approval.
- An E2E suite is allowed only when it is explicitly approved, repository-owned, uses a pinned project dev dependency, and is documented and reproducible in CI; never install it globally.

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

Summarize changed files, verification performed, remaining risks, and a suggested Conventional Commit message. Include one compact routing table row per implementation slice rather than repeating the score for every correction inside that slice. Note UI design deviations as either `local exception` or `promote to master`.

See `CONTRIBUTING.md` for the full human workflow, `docs/architecture.md` for implemented behavior, and `docs/adr/` for the decisions behind these constraints.
