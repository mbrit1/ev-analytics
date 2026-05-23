# useAuth Sign-In/Sign-Out API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the auth context so `useAuth` exposes typed `signIn` and `signOut` methods, then migrate the login/logout UI to consume those methods instead of calling Supabase directly.

**Architecture:** Keep Supabase as the single auth backend but centralize auth mutations inside `AuthProvider`. `useAuth` becomes the public interface for auth state plus auth actions. UI components only depend on the hook contract, improving testability and reducing auth coupling.

**Tech Stack:** React 19, TypeScript, Supabase JS v2, Vitest, React Testing Library

---

### Task 1: Define Auth Hook Contract

**Files:**
- Modify: `src/features/auth/hooks/useAuth.tsx`
- Test: `src/features/auth/hooks/useAuth.test.tsx`

- [ ] **Step 1: Write the failing contract test for exposed methods**

```tsx
/**
 * Auth hook contract tests.
 * Verifies AuthProvider exposes auth state and action methods.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from './useAuth';

describe('useAuth contract', () => {
  it('exposes signIn and signOut functions', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/features/auth/hooks/useAuth.test.tsx`
Expected: FAIL because `signIn` and `signOut` are missing on the hook return type.

- [ ] **Step 3: Add typed methods to the auth context interface and provider value**

```tsx
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
}

const signIn = async (email: string, password: string) => {
  if (isMockMode()) {
    return { error: null };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error };
};

const signOut = async () => {
  if (isMockMode()) {
    return { error: null };
  }
  const { error } = await supabase.auth.signOut();
  return { error };
};

<AuthContext.Provider value={{ user, session, loading, signIn, signOut }}>
  {children}
</AuthContext.Provider>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/features/auth/hooks/useAuth.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/hooks/useAuth.tsx src/features/auth/hooks/useAuth.test.tsx
git commit -m "feat(auth): expose signIn and signOut via useAuth"
```

### Task 2: Migrate LoginForm to use useAuth.signIn

**Files:**
- Modify: `src/features/auth/components/LoginForm.tsx`
- Test: `src/features/auth/components/LoginForm.test.tsx`

- [ ] **Step 1: Write failing LoginForm behavior tests**

```tsx
/**
 * Login form auth integration tests.
 * Verifies hook-based sign-in usage and error rendering.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';

const signInMock = vi.fn();
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ signIn: signInMock }),
}));

describe('LoginForm', () => {
  it('calls useAuth.signIn with submitted credentials', async () => {
    signInMock.mockResolvedValue({ error: null });
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(signInMock).toHaveBeenCalledWith('user@example.com', 'secret123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/features/auth/components/LoginForm.test.tsx`
Expected: FAIL because LoginForm currently calls `supabase.auth.signInWithPassword` directly.

- [ ] **Step 3: Refactor LoginForm to call hook method**

```tsx
import { useAuth } from '../hooks/useAuth';

const { signIn } = useAuth();

const onSubmit = async (data: LoginFormValues) => {
  setLoading(true);
  setAuthError(null);

  const { error } = await signIn(data.email, data.password);
  if (error) {
    setAuthError(error.message);
  }

  setLoading(false);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/features/auth/components/LoginForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/components/LoginForm.tsx src/features/auth/components/LoginForm.test.tsx
git commit -m "refactor(auth): route login through useAuth signIn"
```

### Task 3: Migrate App Logout to use useAuth.signOut

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.auth-gating.test.tsx`

- [ ] **Step 1: Write failing App interaction test for logout action source**

```tsx
/**
 * App auth shell tests.
 * Verifies logout uses auth hook action instead of direct Supabase call.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';

const signOutMock = vi.fn().mockResolvedValue({ error: null });
vi.mock('../../features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: signOutMock }),
}));

describe('App auth shell', () => {
  it('triggers signOut from useAuth when sign-out button is clicked', async () => {
    render(<App />);
    await userEvent.click(screen.getAllByLabelText(/sign out/i)[0]);
    expect(signOutMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/App.auth-gating.test.tsx`
Expected: FAIL because App currently calls `supabase.auth.signOut()` directly.

- [ ] **Step 3: Refactor App logout handler to use hook method**

```tsx
const { user, loading, signOut } = useAuth();

const handleLogout = async () => {
  await signOut();
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run src/App.auth-gating.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.auth-gating.test.tsx
git commit -m "refactor(auth): route logout through useAuth signOut"
```

### Task 4: Verify End-to-End Quality Gates

**Files:**
- Verify: codebase-wide checks (no new file required)

- [ ] **Step 1: Run targeted auth-related tests**

Run: `npm run test -- --run src/features/auth/hooks/useAuth.test.tsx src/features/auth/components/LoginForm.test.tsx src/App.auth-gating.test.tsx`
Expected: PASS with 0 failing tests.

- [ ] **Step 2: Run full required repo gates**

Run: `npm run lint && npm run test -- --run && npm run build`
Expected: all commands exit with code 0.

- [ ] **Step 3: Commit verification-ready state**

```bash
git add -A
git commit -m "test(auth): cover hook contract and auth ui integration"
```

---

## Spec Coverage Check

- Plan requirement “`useAuth` provides current user/session and a `signIn` method” is covered by Task 1.
- Existing architectural expectation that auth actions should be centralized in auth context is fulfilled by Tasks 2 and 3.
- Verification requirement is covered by Task 4 with both targeted and full quality gates.

## Placeholder Scan

- No `TODO` or `TBD` placeholders remain.
- All code-change steps include concrete code snippets and concrete commands.

## Type Consistency Check

- `signIn(email, password)` signature is used consistently in hook and LoginForm task.
- `signOut()` signature is used consistently in hook and App task.
- Hook contract additions align with existing `AuthContextType` pattern.
