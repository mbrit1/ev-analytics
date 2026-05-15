# Automated Quality Gates (CI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a GitHub Actions CI pipeline that verifies code quality (linting, type-checking), data integrity (tests), and production build stability on every PR and push to main.

**Architecture:** A "Fail Fast" parallel pipeline with three distinct jobs: `lint`, `test`, and `build`.

**Tech Stack:** GitHub Actions, Node.js 20, Vitest, TypeScript, Vite.

---

### Task 1: Initialize Workflow Directory

**Files:**
- Create: `.github/workflows/.gitkeep`

- [ ] **Step 1: Create the workflows directory**

Run: `mkdir -p .github/workflows && touch .github/workflows/.gitkeep`

- [ ] **Step 2: Commit initial directory**

```bash
git add .github/workflows/.gitkeep
git commit -m "chore(ci): initialize github workflows directory"
```

---

### Task 2: Implement CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow file with Lint, Test, and Build jobs**

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run test -- --run

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: "https://placeholder.supabase.co"
          VITE_SUPABASE_PUBLISHABLE_KEY: "placeholder-key"
```

- [ ] **Step 2: Verify the YAML syntax locally (if possible)**

Run: `gh auth status` (Ensure logged in)

- [ ] **Step 3: Commit the workflow**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): implement fail-fast parallel pipeline"
```

---

### Task 3: Local Verification of CI Scripts

**Files:**
- Modify: `package.json` (Verify scripts exist and work)

- [ ] **Step 1: Run linting locally to ensure it passes**

Run: `npm run lint`
Expected: PASS (No errors)

- [ ] **Step 2: Run tests locally to ensure they pass**

Run: `npm run test -- --run`
Expected: PASS (All tests passed)

- [ ] **Step 3: Run build locally with placeholder env vars**

Run: `VITE_SUPABASE_URL="https://placeholder.supabase.co" VITE_SUPABASE_PUBLISHABLE_KEY="placeholder-key" npm run build`
Expected: PASS (Production build successful)

- [ ] **Step 4: Commit any fixes if scripts were modified (Optional)**

```bash
git commit -am "fix(ci): ensure scripts are CI-ready"
```

---

### Task 4: Push and Verify on GitHub

**Files:**
- Push current branch to remote.

- [ ] **Step 1: Push the feature branch**

Run: `git push origin feat/phase-4-tariffs`

- [ ] **Step 2: Check Action status via GH CLI**

Run: `gh run list --workflow CI`
Expected: See the new run queued or in progress.

- [ ] **Step 3: Wait for completion and verify results**

Run: `gh run watch` (Select the run if prompted)
Expected: All jobs (lint, test, build) complete with SUCCESS.
