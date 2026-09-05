import type { Session, User } from '@supabase/supabase-js';

export const MOCK_AUTH_CREDENTIALS = {
  access_token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJtb2NrLXVzZXItaWQiLCJlbWFpbCI6InRlc3RlckBsb2NhbC5kZXYiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjQxMDI0NDQ4MDB9.mock-signature',
  refresh_token: 'mock-refresh-token',
} as const;

export const MOCK_AUTH_USER = {
  id: 'mock-user-id',
  email: 'tester@local.dev',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
} as User;

export const MOCK_AUTH_SESSION = {
  ...MOCK_AUTH_CREDENTIALS,
  token_type: 'bearer',
  expires_in: 3_137_452_800,
  expires_at: 4_102_444_800,
  user: MOCK_AUTH_USER,
} as Session;
