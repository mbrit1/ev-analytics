# Contributing to EV Analytics

Thank you for improving EV Analytics. This guide is the canonical engineering workflow for human contributors. Start with `README.md` for the product overview, use `docs/architecture.md` for implemented technical behavior, and use `docs/infrastructure-runbook.md` for environment provisioning and deployment.

## Development Setup

Use the repository-pinned Node.js version 22.22.2 from `.nvmrc`. Supported versions are 22.x ≥22.22.2, 24.x ≥24.15.0, and 26+.

```bash
nvm use
npm install
npm run dev
```

Create `.env.local` from `.env.example` before running outside mock mode. Never commit credentials or other secrets.

## Documentation Ownership

Detailed guidance belongs in one canonical document. Other documents should provide a short summary and link to that source rather than maintain a competing copy. `AGENTS.md` may repeat a small number of non-negotiable constraints because it is the executable repository contract for coding agents.

| Document | Canonical responsibility | Review when |
| --- | --- | --- |
| [`README.md`](./README.md) | Product overview, quick start, commands, and documentation navigation | Capabilities, prerequisites, commands, or entry points change |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Human engineering workflow and documentation ownership | Coding, testing, review, or contribution policy changes |
| [`AGENTS.md`](./AGENTS.md) | Durable repository instructions for coding agents | Agent constraints, required checks, or handoff rules change |
| [`docs/architecture.md`](./docs/architecture.md) | Implemented current-state layers, data flows, models, and semantics | Runtime behavior, boundaries, persistence, synchronization, or analytics change |
| [`docs/adr/`](./docs/adr/) | Rationale and history for significant architectural decisions | A significant decision is introduced, reversed, or superseded |
| [`docs/infrastructure-runbook.md`](./docs/infrastructure-runbook.md) | Provisioning, deployment, validation, and operational troubleshooting | Schema provisioning, environment variables, hosting, or deployment changes |
| [`docs/design/`](./docs/design/) | Current UI design-system baseline and review checklist | UI-governance reference changes |

Use these documentation-change triggers:

- Schema or RLS changes require review of the architecture guide, infrastructure runbook, and relevant ADRs.
- Toolchain or command changes require review of README, CONTRIBUTING, CI, and agent verification instructions.
- Architectural changes require an ADR and a current-state architecture update once implemented.
- Deployment changes require the hosting ADR and infrastructure runbook to change together.
- Analytics changes must document time boundaries, missing-value behavior, snapshot use, soft-delete treatment, and metric-specific energy semantics.
- UI-governance changes belong in the normative design baseline or checklist in `docs/design/`.

## Architecture and Domain Rules

Application code is organized into the app shell, feature domains, shared building blocks, and infrastructure adapters:

- `src/app/`: application composition and provider wiring
- `src/features/<domain>/`: domain components, hooks, services, and models
- `src/shared/ui/`: reusable, domain-agnostic UI primitives
- `src/shared/lib/`: pure helpers without infrastructure dependencies
- `src/infra/`: Dexie, Supabase, and mock implementations

Keep these boundaries intact:

- Features may depend on shared code and approved infrastructure interfaces.
- Shared and infrastructure code must not import feature code.
- Cross-feature imports must go through `src/features/<domain>/index.ts`.
- Prefer feature-local implementation before introducing a shared abstraction.

The product must remain offline-first. Creating or editing charging data must not require connectivity: write locally through Dexie and the outbox, update the UI optimistically, and synchronize with Supabase later. Keep Supabase private and authenticated with default-deny RLS.

Store money as integer cents, render EUR with European decimal formatting, accept comma decimal separators in numeric money and energy inputs, store dates in UTC, and preserve pricing snapshots on sessions. Missing optional measurements such as odometer, SoC, or energy values must remain unavailable rather than being converted to zero. Record significant architectural changes in `docs/adr/`.

## Code and Tests

Use strict TypeScript and React function components. Components use `PascalCase.tsx`, hooks `useName.ts`, services `nameService.ts`, and tests `*.test.ts(x)`.

Add concise JSDoc to exported interfaces, props types, and components. Comments should explain intent, important layout behavior, or domain constraints rather than repeat TypeScript. Do not add emojis to source, comments, or configuration unless they are intentionally rendered in the UI.

Keep tests beside the code they cover. Each test file should have a suite-level JSDoc block above its main `describe`, and each test should use `// Arrange`, `// Act`, and `// Assert` comments. Cover changed domain behavior and user workflows, with particular attention to offline sync, idempotency, retry behavior, pricing snapshots, and missing optional values.

For structural refactors, move code first without changing behavior. Make behavioral changes separately and add targeted tests.

## UI and Design Governance

Use `docs/design/design-system-baseline.html` as the default token and component baseline. Apply `docs/design/governance-checklist.md` to UI changes.

Verify affected mobile and desktop layouts and provide screenshots or another evidence location with the pull request. Sanitize screenshots before sharing. If screenshots contain sensitive data, keep them local and state in the pull request why they are withheld and where the evidence is available to maintainers. Cover keyboard, focus, accessibility, and 44px touch targets. If a screen intentionally improves on the baseline, identify the deviation in the handoff as either `local exception` or `promote to master`.

Data-entry workflows must remain practical one-handed and in poor connectivity. Use appropriate `inputMode` values for numeric fields, preserve localized decimal input, maintain touch targets of at least 44px, and keep offline and pending-sync state visible.

## Git Workflow

1. Start from an up-to-date `main` and create a semantic branch such as `feat/...`, `fix/...`, or `docs/...`.
2. Keep changes small and focused; avoid unrelated refactors.
3. Use Conventional Commits, for example `feat(sync): implement offline outbox queue`.
4. Include a commit body that explains the motivation and meaningful trade-offs rather than repeating the diff.

Do not commit directly to `main`. Automated coding agents must not push, open pull requests, or merge without explicit human authorization.

Dependabot is an existing exception for non-draft development-dependency updates classified as semver-patch: configured automation may approve and auto-merge these updates, subject to the repository's configured GitHub merge requirements. This exception does not authorize agents to publish or merge their own changes.

### GitHub publication privacy

GitHub-facing text must never disclose local usernames, home directories, absolute machine paths, worktree or temporary paths, or private screenshot/evidence locations. This applies to PR and issue titles/descriptions, comments and outgoing commit messages. Use repository-relative paths for repository files. Describe private screenshots only as retained locally and not attached. Inspect screenshots separately for sensitive content before attaching them; the text validator does not inspect images.

Prepare the exact outgoing text in files, including a separate file for its title when applicable. Run the dependency-free validator before every write, including edits intended to correct an earlier disclosure:

```bash
npm run --silent github:check -- --file pr-title.txt --file pr-body.md
npm run --silent github:check -- --stdin < comment.md
npm run --silent github:check -- --commits origin/main..HEAD
```

The command exits nonzero for a detected disclosure or invalid/unreadable input. It reports only source ordinals, line numbers and categories, never the matched text or input filename. At least one source is required. Multiple files, stdin and an outgoing two-dot commit range can be checked together. Verify the commit base against the destination before scanning; an empty or invalid range fails. Do not scan only the last commit when a push publishes several commits.

Chain the check and the authorized write with `&&` so a failed scan prevents publication. For example, after checking a prepared PR title/body:

```bash
npm run --silent github:check -- --file pr-title.txt --file pr-body.md &&
  gh pr create --title "$(cat pr-title.txt)" --body-file pr-body.md
```

Do not edit the prepared inputs between validation and publication. Do not bypass the gate using a raw CLI call or connector. After every write, retrieve the published title/body/comment into private local files, run the same validator and compare the retrieved text with the prepared content. Only then report publication complete. The checks do not themselves authorize a commit, push or GitHub write.

The validator detects common local path forms, encoded paths and the current local identity. Additional private identity tokens can be provided through the local, newline-separated `GITHUB_PUBLICATION_PRIVATE_TOKENS` environment variable; never commit those values. Known path forms are blocked even when they contain a different username. Repository-relative paths, public web links and units remain allowed.

This is a required publication workflow gate, not an interception of every possible `git`, `gh` or connector invocation. It cannot discover every arbitrary identity or private fact; retain a human-readable privacy review and inspect attachments separately. CI runs the validator's regression tests, but a CI failure after publication cannot prevent the original disclosure.

## Verification

Run focused tests while developing. Before proposing a push or pull request, run the complete verification gate:

```bash
npm run lint && npm run test -- --run && npm run build
```

Vitest and `@vitest/ui` must use matching versions. To open the test UI, run
`npm run test -- --ui` and open the authenticated URL printed by Vitest. Vitest 5
requires the token in that URL for the UI page and API access.

For documentation-only changes, run `npm run docs:check` and `git diff --check`; application tests are not required unless executable examples or documentation tooling changed.

Changes to the canonical schema, table-access rules, or the live RLS verifier must also run the standalone contract tests:

```bash
node --test scripts/schema-grants.node-test.mjs scripts/verify-rls-live.node-test.mjs
```

These tests use mocked network responses and do not validate live production RLS. CI always runs this command in its test job, independently of the Vitest suite.

For performance-sensitive changes, including dependencies, major UI work, or bundling/runtime changes, also run:

```bash
npm run build:analyze
```

Report notable bundle-size changes or top chunk drivers. For project-structure changes, report moved paths and their import-boundary impact.

## Pull Requests and Handoffs

Pull requests should include:

- the change type, a concise summary and reason, any linked issue, and an explanation of breaking impact;
- exact verification commands and results, meaningful coverage added or updated where relevant, and omitted checks or validation gaps;
- UI evidence for affected mobile and desktop layouts, keyboard/focus/accessibility behavior, and 44px touch targets; screenshots may be sanitized or kept locally with the reason stated and no private filesystem location disclosed;
- conditional domain and security evidence for offline persistence and sync, money and date semantics, authentication and owner-scoped access, privacy, secrets, and import boundaries;
- canonical documentation or ADR updates, or why none were needed, plus known risks, follow-up work, operational steps, and intentional design deviations; and
- moved paths and boundary impact for structural changes.

When handing work to another contributor, summarize changed files, exact validation commands and results, omitted checks and gaps, relevant change and breaking type, conditional UI or domain evidence, remaining risks, and a suggested Conventional Commit message. A maintainer's local review counts as human review; it does not require updating a pull request checkbox or adding a mandatory review comment.

## Security and Infrastructure

Do not commit secrets. Local Supabase credentials belong in `.env.local`; `.env.example` documents required keys. Preserve authenticated, owner-scoped RLS and the application's private, single-user posture.

Use `docs/infrastructure-runbook.md` for Supabase provisioning, environment validation, deployment, and operational troubleshooting.

Current architecture belongs in `docs/architecture.md`; architectural rationale belongs in `docs/adr/`. Git history preserves superseded feature designs and implementation plans without treating them as current documentation.
