/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { isMockMode } from '../../../lib/mock-utils';

interface AuthContextType {
  /** The current Supabase user, or the local mock user when mock mode is active. */
  user: User | null;
  /** The current Supabase session, including tokens needed by Supabase clients. */
  session: Session | null;
  /** True while the initial Supabase session lookup is still unresolved. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Provides authenticated user and session state to the application.
 *
 * In mock mode, the provider seeds a deterministic local user/session so the
 * app can render authenticated flows without contacting Supabase. Otherwise it
 * hydrates the current Supabase session and keeps context in sync with future
 * auth events.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    // Mock mode represents a signed-in user from the first render, avoiding a
    // loading flash in local/offline development.
    if (isMockMode()) {
      return {
        id: 'mock-user-id',
        email: 'tester@local.dev',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      } as User;
    }
    return null;
  });

  const [session, setSession] = useState<Session | null>(() => {
    // Supabase's Session shape is preserved here so downstream code can rely on
    // the same fields in mock and live modes.
    if (isMockMode()) {
      return {
        access_token: 'mock-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh-token',
        user: {
          id: 'mock-user-id',
          email: 'tester@local.dev',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        } as User,
      } as Session;
    }
    return null;
  });

  const [loading, setLoading] = useState(!isMockMode());

  useEffect(() => {
    if (isMockMode()) return;

    // Hydrate persisted auth state before rendering protected application
    // content. Supabase may restore this from browser storage.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Keep React context aligned with Supabase events such as sign-in, sign-out,
    // token refresh, and password recovery.
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

/**
 * Reads authentication state from {@link AuthProvider}.
 *
 * @throws When used outside an AuthProvider tree.
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
