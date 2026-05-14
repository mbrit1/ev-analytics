# Phase 2: Core Infrastructure (Auth & Database) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Supabase authentication foundation and PostgreSQL database schema with Row-Level Security (RLS).

**Architecture:** Use Supabase Auth for identity and PostgreSQL RLS for single-user data privacy. The frontend uses a React Context provider to manage session state and a dedicated Login feature.

**Tech Stack:** React (TypeScript), Supabase, Tailwind CSS.

---

## File Structure

- `supabase/schema.sql`: Complete PostgreSQL schema and RLS policies.
- `src/lib/supabase.ts`: Supabase client initialization.
- `.env.local`: Environment variables (URL and Anon Key).
- `src/features/auth/hooks/useAuth.tsx`: Auth context and custom hook.
- `src/features/auth/components/LoginForm.tsx`: Mobile-friendly login UI.
- `src/App.tsx`: Main entry point with conditional auth rendering.

---

### Task 1: Supabase Database Schema & RLS

**Files:**

- Create: `supabase/schema.sql`

- [ ] **Step 1: Write the schema SQL**

```sql
-- 1. Providers Table
CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own providers"
    ON providers FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2. Tariffs Table
CREATE TABLE tariffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    tariff_name TEXT NOT NULL,
    ac_price_per_kwh INTEGER NOT NULL, -- Stored in cents
    dc_price_per_kwh INTEGER NOT NULL, -- Stored in cents
    session_fee INTEGER NOT NULL DEFAULT 0, -- Stored in cents
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own tariffs"
    ON tariffs FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3. Charging Sessions Table
CREATE TABLE charging_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_timestamp TIMESTAMPTZ NOT NULL,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    tariff_id UUID NOT NULL REFERENCES tariffs(id) ON DELETE RESTRICT,
    location_type TEXT NOT NULL CHECK (location_type IN ('Home', 'Work', 'Public', 'Fast Charger')),
    charging_type TEXT NOT NULL CHECK (charging_type IN ('AC', 'DC')),
    kwh_billed NUMERIC(6, 2) NOT NULL,
    kwh_added NUMERIC(6, 2), -- Optional efficiency tracking
    total_cost INTEGER NOT NULL, -- Stored in cents
    odometer_km INTEGER,
    start_soc INTEGER CHECK (start_soc >= 0 AND start_soc <= 100),
    end_soc INTEGER CHECK (end_soc >= 0 AND end_soc <= 100),
    notes TEXT,
    
    -- Snapshots of the tariff at the time of the session
    applied_ac_price INTEGER NOT NULL,
    applied_dc_price INTEGER NOT NULL,
    applied_session_fee INTEGER NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE charging_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own charging sessions"
    ON charging_sessions FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Indices for performance
CREATE INDEX idx_tariffs_provider ON tariffs(provider_id);
CREATE INDEX idx_sessions_timestamp ON charging_sessions(session_timestamp DESC);
CREATE INDEX idx_sessions_user_timestamp ON charging_sessions(user_id, session_timestamp DESC);
```

- [ ] **Step 2: Verify SQL syntax**
- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): initialize supabase schema with RLS"
```

---

### Task 2: Supabase Client & Environment Setup

**Files:**

- Create: `src/lib/supabase.ts`
- Create: `.env.example`

- [ ] **Step 1: Create .env.example**

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 2: Implement Supabase Client**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts .env.example
git commit -m "feat(auth): initialize supabase client"
```

---

### Task 3: Auth Provider & Hook

**Files:**

- Create: `src/features/auth/hooks/useAuth.tsx`

- [ ] **Step 1: Implement AuthProvider**

```tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active sessions and set the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/features/auth/hooks/useAuth.tsx
git commit -m "feat(auth): implement AuthProvider and useAuth hook"
```

---

### Task 4: Login UI Component

**Files:**

- Create: `src/features/auth/components/LoginForm.tsx`

- [ ] **Step 1: Implement LoginForm**

```tsx
import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { LogIn, Loader2 } from 'lucide-react';

export const LoginForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">EV Charging Analytics</h1>
          <p className="mt-2 text-sm text-gray-600">Private single-user access</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 mt-1 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center w-full py-3 px-4 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5 mr-2" />
                Sign In
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/features/auth/components/LoginForm.tsx
git commit -m "feat(auth): create mobile-friendly LoginForm"
```

---

### Task 5: App Integration

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Wrap App with AuthProvider in main.tsx**

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './features/auth/hooks/useAuth'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
```

- [ ] **Step 2: Implement Conditional Auth in App.tsx**

```tsx
// src/App.tsx
import { useAuth } from './features/auth/hooks/useAuth'
import { LoginForm } from './features/auth/components/LoginForm'
import { Loader2 } from 'lucide-react'

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Welcome, {user.email}</h1>
      <p className="mt-4">Charging history and analytics will appear here.</p>
      {/* TODO: Add Logout button */}
    </div>
  )
}

export default App
```

- [ ] **Step 3: Verify build and types**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat(auth): integrate AuthProvider and conditional routing"
```
