# Contributing to EV Analytics

Thank you for improving EV Analytics. This guide is the canonical engineering workflow for human contributors. Start with `README.md` for the product and architecture overview, and use `docs/infrastructure-runbook.md` for environment provisioning and deployment.

## Development Setup

The project requires Node.js 22.20.0 or newer. The repository version is recorded in `.nvmrc`.

```bash
nvm use
npm install
npm run dev
```

Create `.env.local` from `.env.example` before running outside mock mode. Never commit credentials or other secrets.

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

Store money as integer cents, render EUR with European decimal formatting, store dates in UTC, and preserve pricing snapshots on sessions. Record significant architectural changes in `docs/adr/`.

## Code and Tests

Use strict TypeScript and React function components. Components use `PascalCase.tsx`, hooks `useName.ts`, services `nameService.ts`, and tests `*.test.ts(x)`.

Add concise JSDoc to exported interfaces, props types, and components. Comments should explain intent, important layout behavior, or domain constraints rather than repeat TypeScript. Do not add emojis to source, comments, or configuration unless they are intentionally rendered in the UI.

Keep tests beside the code they cover. Each test file should have a suite-level JSDoc block above its main `describe`, and each test should use `// Arrange`, `// Act`, and `// Assert` comments. Cover changed domain behavior and user workflows, with particular attention to offline sync, idempotency, retry behavior, pricing snapshots, and missing optional values.

For structural refactors, move code first without changing behavior. Make behavioral changes separately and add targeted tests.

## UI and Design Governance

Use `docs/superpowers/specs/2026-05-16-Design-System-Sandbox-v2.0.html` as the default token and component baseline. Apply `docs/superpowers/specs/2026-05-29-design-governance-checklist.md` to UI changes.

Verify affected mobile and desktop layouts and include screenshots with the pull request. If a screen intentionally improves on the baseline, identify the deviation in the handoff as either `local exception` or `promote to master`.

## Git Workflow

1. Start from an up-to-date `main` and create a semantic branch such as `feat/...`, `fix/...`, or `docs/...`.
2. Keep changes small and focused; avoid unrelated refactors.
3. Use Conventional Commits, for example `feat(sync): implement offline outbox queue`.
4. Explain motivation and meaningful trade-offs in the commit body.

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
