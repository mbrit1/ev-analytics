# Contributing to EV Analytics

Thank you for improving EV Analytics. This guide is the canonical engineering workflow for human contributors. Start with `README.md` for the product overview, use `docs/architecture.md` for implemented technical behavior, and use `docs/infrastructure-runbook.md` for environment provisioning and deployment.

## Development Setup

The project requires Node.js 22.20.0 or newer. The repository version is recorded in `.nvmrc`.

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
| [`docs/superpowers/`](./docs/superpowers/README.md) | Historical design/implementation records and named normative UI references | A record is added or an active UI-governance reference changes |

Use these documentation-change triggers:

- Schema or RLS changes require review of the architecture guide, infrastructure runbook, and relevant ADRs.
- Toolchain or command changes require review of README, CONTRIBUTING, CI, and agent verification instructions.
- Architectural changes require an ADR and a current-state architecture update once implemented.
- Deployment changes require the hosting ADR and infrastructure runbook to change together.
- Analytics changes must document time boundaries, missing-value behavior, snapshot use, soft-delete treatment, and metric-specific energy semantics.
- UI-governance changes belong in the normative design baseline or checklist identified by `docs/superpowers/README.md`.

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

Use `docs/superpowers/specs/2026-05-16-Design-System-Sandbox-v2.0.html` as the default token and component baseline. Apply `docs/superpowers/specs/2026-05-29-design-governance-checklist.md` to UI changes.

Verify affected mobile and desktop layouts and include screenshots with the pull request. If a screen intentionally improves on the baseline, identify the deviation in the handoff as either `local exception` or `promote to master`.

Data-entry workflows must remain practical one-handed and in poor connectivity. Use appropriate `inputMode` values for numeric fields, preserve localized decimal input, maintain touch targets of at least 44px, and keep offline and pending-sync state visible.

## Git Workflow

1. Start from an up-to-date `main` and create a semantic branch such as `feat/...`, `fix/...`, or `docs/...`.
2. Keep changes small and focused; avoid unrelated refactors.
3. Use Conventional Commits, for example `feat(sync): implement offline outbox queue`.
4. Include a commit body that explains the motivation and meaningful trade-offs rather than repeating the diff.

Do not commit directly to `main`. Automated coding agents must not push, open pull requests, or merge without explicit human authorization.

## Verification

Run focused tests while developing. Before proposing a push or pull request, run the complete verification gate:

```bash
npm run lint && npm run test -- --run && npm run build
```

For documentation-only changes, check links and references and run `git diff --check`; application tests are not required unless executable examples or documentation tooling changed.

For performance-sensitive changes, including dependencies, major UI work, or bundling/runtime changes, also run:

```bash
npm run build:analyze
```

Report notable bundle-size changes or top chunk drivers. For project-structure changes, report moved paths and their import-boundary impact.

## Pull Requests and Handoffs

Pull requests should include:

- a concise summary of the change and why it is needed;
- verification commands and results;
- linked issues, specifications, or ADRs;
- screenshots for UI changes;
- known risks, follow-up work, or intentional design deviations; and
- moved paths and boundary impact for structural changes.

When handing work to another contributor, summarize changed files, verification performed, remaining risks, and a suggested Conventional Commit message.

## Security and Infrastructure

Do not commit secrets. Local Supabase credentials belong in `.env.local`; `.env.example` documents required keys. Preserve authenticated, owner-scoped RLS and the application's private, single-user posture.

Use `docs/infrastructure-runbook.md` for Supabase provisioning, environment validation, deployment, and operational troubleshooting.

Current architecture belongs in `docs/architecture.md`; architectural rationale belongs in `docs/adr/`. Dated files under `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical records unless `docs/superpowers/README.md` explicitly identifies them as normative.
