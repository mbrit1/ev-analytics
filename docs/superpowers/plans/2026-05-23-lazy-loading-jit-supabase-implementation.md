# Lazy Loading + JIT Supabase + Targeted Form Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce initial bundle pressure by deferring rare tariff and sync-heavy paths while preserving fast login/session core flows and offline-first behavior.

**Architecture:** The app shell lazy-loads only the tariff view and optionally idle-prefetches it after authenticated startup. Sync runtime loading is split so Supabase/sync engine logic is initialized just in time after auth gating. Tariff form internals are split so `react-hook-form` + `zod` move out of the initial bundle path, while session core form remains unchanged.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Dexie, Supabase, react-hook-form, zod

---

## File Structure and Responsibilities

- `src/app/App.tsx`
  - Owns top-level tab rendering and is the correct place for tariff view lazy boundary and idle prefetch.
- `src/app/App.auth-gating.test.tsx`
  - Verifies app auth gating and should cover lazy-loaded tariff tab behavior.
- `src/features/offline-sync/services/syncRuntime.ts`
  - Runtime orchestrator; receives JIT loading hook for sync engine functions.
- `src/features/offline-sync/services/syncRuntime.test.ts`
  - Asserts startup/online/outbox trigger semantics after deferred loading.
- `src/features/offline-sync/index.ts`
  - Public feature export surface; may expose new runtime factory/wiring.
- `src/features/tariffs/components/TariffList.tsx`
  - Coordinates tariff page state and can lazy-load the tariff form implementation.
- `src/features/tariffs/components/TariffForm.tsx`
  - Existing form implementation using `react-hook-form` + `zod`; can become internal lazy target.
- `src/features/tariffs/components/TariffFormLoader.tsx` (new)
  - Lightweight shell that lazy-loads `TariffForm` and provides fallback.
- `src/features/tariffs/components/TariffForm.test.tsx`
  - Verifies behavior parity for tariff form interactions through loader.

---

### Task 1: App-level tariff lazy loading with idle prefetch

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.auth-gating.test.tsx`
- Test: `src/app/App.auth-gating.test.tsx`

- [ ] **Step 1: Write/update failing test for direct tariff module mocking path**

```tsx
vi.mock('../features/tariffs/components/TariffList', () => ({
  TariffList: () => <div>Tariff List</div>,
}));
```

Add or keep an assertion that authenticated app render with tariffs tab path still resolves the mocked tariff content.

- [ ] **Step 2: Run test to verify RED before implementation update**

Run: `npm run test -- --run src/app/App.auth-gating.test.tsx`
Expected: FAIL due to old mock import path or lazy-boundary mismatch.

- [ ] **Step 3: Implement lazy tariff import and idle prefetch in app shell**

```tsx
const TariffList = lazy(async () => {
  const module = await import('../features/tariffs/components/TariffList');
  return { default: module.TariffList };
});

useEffect(() => {
  if (!user) return;
  const prefetch = () => void import('../features/tariffs/components/TariffList');
  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(prefetch, { timeout: 1500 });
    return () => window.cancelIdleCallback(idleId);
  }
  const timeoutId = window.setTimeout(prefetch, 800);
  return () => window.clearTimeout(timeoutId);
}, [user]);
```

Wrap tariff tab render in `Suspense` fallback spinner and keep sessions branch unchanged.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm run test -- --run src/app/App.auth-gating.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/app/App.auth-gating.test.tsx
git commit -m "perf(app): lazy load tariffs view with idle prefetch"
```

---

### Task 2: Defer sync-engine/supabase-heavy runtime initialization (JIT)

**Files:**
- Modify: `src/features/offline-sync/services/syncRuntime.ts`
- Modify: `src/features/offline-sync/services/syncRuntime.test.ts`
- Modify: `src/features/offline-sync/index.ts` (if export wiring changes)
- Test: `src/features/offline-sync/services/syncRuntime.test.ts`

- [ ] **Step 1: Write failing test for deferred engine loading contract**

Add test ensuring startup does not require eager imported `initialSync/processOutbox`, but resolves them through loader dependency only when authenticated runtime starts.

```ts
const loadSyncEngine = vi.fn(async () => ({
  initialSync: vi.fn(async () => undefined),
  processOutbox: vi.fn(async () => undefined),
}));
```

Expect `loadSyncEngine` not called for unauthenticated startup and called once for authenticated startup.

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- --run src/features/offline-sync/services/syncRuntime.test.ts`
Expected: FAIL because runtime has static syncEngine imports.

- [ ] **Step 3: Implement JIT sync-engine loader in runtime**

Refactor `syncRuntime.ts` to remove top-level sync engine imports and add lazy loader dependency:

```ts
export interface SyncRuntimeDeps {
  loadSyncEngine: () => Promise<{
    initialSync: () => Promise<void>;
    processOutbox: () => Promise<void>;
  }>;
  // existing listeners/logger deps
}

const defaultDeps: SyncRuntimeDeps = {
  loadSyncEngine: async () => import('./syncEngine'),
  // existing deps
};
```

Inside `run()`, resolve engine once per runtime instance before first hydrate/process and reuse references.

- [ ] **Step 4: Run runtime tests to verify GREEN**

Run: `npm run test -- --run src/features/offline-sync/services/syncRuntime.test.ts`
Expected: PASS with unchanged trigger/retry behavior.

- [ ] **Step 5: Commit**

```bash
git add src/features/offline-sync/services/syncRuntime.ts src/features/offline-sync/services/syncRuntime.test.ts src/features/offline-sync/index.ts
git commit -m "perf(sync): defer sync engine initialization until auth runtime"
```

---

### Task 3: Lazy split tariff form (`react-hook-form` + `zod`) in rare flow

**Files:**
- Create: `src/features/tariffs/components/TariffFormLoader.tsx`
- Modify: `src/features/tariffs/components/TariffList.tsx`
- Modify: `src/features/tariffs/components/TariffForm.test.tsx`
- Optionally modify: `src/features/tariffs/components/TariffForm.tsx` (export cleanup only)
- Test: `src/features/tariffs/components/TariffForm.test.tsx`

- [ ] **Step 1: Write failing test for loader-based tariff form render**

Update tests to render through loader path used by `TariffList` and assert existing form fields still appear.

```tsx
render(<TariffList />);
await screen.findByLabelText(/tariff name/i);
```

Mock hooks as needed so test isolates lazy boundary behavior.

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- --run src/features/tariffs/components/TariffForm.test.tsx`
Expected: FAIL because loader component does not exist yet.

- [ ] **Step 3: Implement lazy loader wrapper and wire in TariffList**

Create `TariffFormLoader.tsx`:

```tsx
const TariffForm = lazy(async () => {
  const module = await import('./TariffForm');
  return { default: module.TariffForm };
});

export function TariffFormLoader(props: TariffFormProps) {
  return (
    <Suspense fallback={<div className="p-6 text-secondary">Loading form…</div>}>
      <TariffForm {...props} />
    </Suspense>
  );
}
```

Replace `TariffForm` usage in `TariffList.tsx` with `TariffFormLoader`.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm run test -- --run src/features/tariffs/components/TariffForm.test.tsx`
Expected: PASS with same functional assertions.

- [ ] **Step 5: Commit**

```bash
git add src/features/tariffs/components/TariffFormLoader.tsx src/features/tariffs/components/TariffList.tsx src/features/tariffs/components/TariffForm.test.tsx
git commit -m "perf(tariffs): lazy split tariff form validation stack"
```

---

### Task 4: Full verification + bundle analysis handoff notes

**Files:**
- Optional Modify: `docs/superpowers/specs/2026-05-23-lazy-loading-jit-supabase-design.md` (if minor addendum needed)
- Optional Create: `docs/superpowers/plans/2026-05-23-lazy-loading-jit-supabase-verification.md` (if explicit metrics note preferred)

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Run tests (single run)**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS and generated production bundle.

- [ ] **Step 4: Run bundle analysis build**

Run: `npm run build:analyze`
Expected: PASS and updated analyzer outputs (e.g., `dist/bundle-stats.json`).

- [ ] **Step 5: Record delta summary + commit only if docs changed**

If adding verification notes file:

```bash
git add docs/superpowers/plans/2026-05-23-lazy-loading-jit-supabase-verification.md
git commit -m "chore(perf): document bundle analysis deltas"
```

---

## Self-Review Checklist

- Spec coverage: A/B/C all mapped to Tasks 1/2/3; verification mapped to Task 4.
- Placeholder scan: no TBD/TODO placeholders in executable steps.
- Type consistency: `TariffFormProps` contract preserved through loader; sync runtime loader returns `{ initialSync, processOutbox }` consistently.
