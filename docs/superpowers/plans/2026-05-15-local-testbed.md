# Local Testbed with MSW Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a safe, build-time guarded local development environment using Mock Service Worker (MSW) to simulate Supabase Auth and REST APIs.

**Architecture:** Use MSW to intercept network requests in the browser during development. Use Vite's `import.meta.env.DEV` to ensure mock code is tree-shaken from production builds.

**Tech Stack:** React, Vite, MSW (Mock Service Worker), TypeScript.

---

### Task 1: Setup Dependencies and Environment

**Files:**
- Modify: `package.json`
- Create: `.env.local`

- [x] **Step 1: Install MSW as a dev dependency**

Run: `npm install -D msw`

- [x] **Step 2: Initialize MSW service worker**

Run: `npx msw init public/ --save`

- [x] **Step 3: Create .env.local for local mocks**

```env
VITE_ENABLE_MOCKS=true
```

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.local
git commit -m "chore: setup msw and local env variables"
```

---

### Task 2: Implement Mock Detection Utility

**Files:**
- Create: `src/lib/mock-utils.ts`

- [ ] **Step 1: Create mock detection logic with build-time guards**

```typescript
export const isMockMode = (): boolean => {
  return (
    import.meta.env.DEV && 
    import.meta.env.VITE_ENABLE_MOCKS === 'true'
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mock-utils.ts
git commit -m "feat: add mock detection utility"
```

---

### Task 3: Define MSW Handlers

**Files:**
- Create: `src/mocks/handlers.ts`

- [ ] **Step 1: Implement basic handlers for Supabase Auth and REST**

```typescript
import { http, HttpResponse, delay } from 'msw'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'

export const handlers = [
  // Mock Auth Token Request
  http.post(`${SUPABASE_URL}/auth/v1/token`, async () => {
    await delay(500)
    return HttpResponse.json({
      access_token: 'mock-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'mock-refresh-token',
      user: {
        id: 'mock-user-id',
        email: 'tester@local.dev',
        role: 'authenticated',
      },
    })
  }),

  // Mock Generic Database Insert/Update
  http.post(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(800)
    return new HttpResponse(null, { status: 201 })
  }),

  // Mock Generic Database Fetch
  http.get(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(300)
    return HttpResponse.json([])
  }),
]
```

- [ ] **Step 2: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "feat: implement msw handlers for supabase"
```

---

### Task 4: Configure MSW Browser Worker

**Files:**
- Create: `src/mocks/browser.ts`

- [ ] **Step 1: Setup the worker with defined handlers**

```typescript
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
```

- [ ] **Step 2: Commit**

```bash
git add src/mocks/browser.ts
git commit -m "feat: configure msw browser worker"
```

---

### Task 5: Integrate MSW in Main Entry Point

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Initialize MSW conditionally during development**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isMockMode } from './lib/mock-utils'

async function enableMocking() {
  if (!isMockMode()) {
    return
  }

  const { worker } = await import('./mocks/browser')
  return worker.start({
    onUnhandledRequest: 'bypass',
  })
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
```

- [ ] **Step 2: Commit**

```bash
git add src/main.tsx
git commit -m "feat: integrate msw in main entry point"
```

---

### Task 6: Adapt Auth Hook for Bypass

**Files:**
- Modify: `src/features/auth/hooks/useAuth.tsx`

- [ ] **Step 1: Update hook to return mock user when in mock mode**

```typescript
// Add to imports
import { isMockMode } from '../../../lib/mock-utils'

// Inside useAuth hook, update the state initialization or effect
useEffect(() => {
  if (isMockMode()) {
    setUser({ id: 'mock-user-id', email: 'tester@local.dev' } as any)
    setLoading(false)
    return
  }
  
  // Existing Supabase auth logic...
}, [])
```

- [ ] **Step 2: Commit**

```bash
git add src/features/auth/hooks/useAuth.tsx
git commit -m "feat: adapt auth hook for mock mode bypass"
```

---

### Task 7: Verification

- [ ] **Step 1: Verify Local Dev Behavior**
Run: `npm run dev`
Expected: App opens, bypasses login, and sessions/tariffs can be added. Sync indicator changes from ⏳ to ✅.

- [ ] **Step 2: Verify Production Build**
Run: `npm run build`
Check output: Search for 'msw' or 'mock-user-id' in the `dist/` JS files.
Expected: No occurrences found (code tree-shaken).
