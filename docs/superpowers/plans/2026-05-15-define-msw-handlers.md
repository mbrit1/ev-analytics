# MSW Handlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement basic MSW handlers for Supabase Auth and REST to intercept network calls during testing and local development.

**Architecture:** Use Mock Service Worker (MSW) to define handlers that match Supabase URL patterns and return mock responses with randomized delays to simulate real network conditions.

**Tech Stack:** MSW, TypeScript, Vite.

---

### Task 1: Define MSW Handlers

**Files:**
- Create: `src/mocks/handlers.ts`

- [x] **Step 1: Implement basic handlers for Supabase Auth and REST**

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

- [x] **Step 2: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "feat: implement msw handlers for supabase"
```
