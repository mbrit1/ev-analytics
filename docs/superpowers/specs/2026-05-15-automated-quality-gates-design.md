# Design Spec: Automated Quality Gates (CI)

This document outlines the design for the GitHub Actions CI pipeline to ensure code quality and build stability for the `ev-analytics` project.

## 1. Problem Statement
Currently, there is no automated verification that new code passes tests, adheres to linting rules, or builds successfully before being merged into the `main` branch. This risks introducing regressions in the offline sync engine, breaking the PWA configuration, or failing deployments.

## 2. Goals & Success Criteria
- **Prevent Regressions:** Automatically run all Vitest tests on every Pull Request.
- **Enforce Standards:** Ensure ESLint and TypeScript checks pass.
- **Ensure Buildability:** Verify that the production build (`vite build`) completes without errors.
- **Fast Feedback:** Provide results within 2-3 minutes.

## 3. Architecture: The "Fail Fast" Pipeline
The workflow will consist of three parallel jobs to maximize throughput and provide granular feedback.

### Trigger Strategy
- **On Pull Request:** Targeted at the `main` branch.
- **On Push:** To the `main` branch (to ensure post-merge health).

### Job Definitions

#### Job 1: Lint & Type-Check
- **Environment:** `ubuntu-latest`
- **Command:** `npm run lint`
- **Purpose:** Fast check for syntax, style, and TypeScript errors.

#### Job 2: Unit & Integration Tests
- **Environment:** `ubuntu-latest`
- **Command:** `npm run test -- --run`
- **Purpose:** Executes the full Vitest suite. Since the project uses `fake-indexeddb` and `msw`, no external services are required.

#### Job 3: Production Build
- **Environment:** `ubuntu-latest`
- **Command:** `npm run build`
- **Env Vars:** Dummy values for `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` will be provided to satisfy Vite/TypeScript requirements during the build process.
- **Purpose:** Ensures the code can be bundled for Cloudflare Pages and PWA assets are generated correctly.

## 4. Implementation Details

### GitHub Actions Configuration
- File: `.github/workflows/ci.yml`
- Node Version: `20.x`
- Dependency Management: `npm ci` (for clean, reproducible installs).
- Caching: Use `actions/setup-node`'s built-in caching for `npm`.

### Dependencies
No new dependencies are required; we will utilize existing `package.json` scripts.

## 5. Risk & Mitigation
- **Risk:** Slow runs due to large `node_modules`.
- **Mitigation:** Aggressive caching of the `npm` cache.
- **Risk:** Build failures due to missing environment variables.
- **Mitigation:** Explicitly provide non-sensitive dummy strings in the workflow file.
