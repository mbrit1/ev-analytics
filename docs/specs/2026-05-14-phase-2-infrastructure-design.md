# Design Spec: Phase 2 - Core Infrastructure (Auth & Database)

**Status:** Draft
**Date:** 2026-05-14
**Topic:** Authentication and Database Foundation

## 1. Overview
Phase 2 establishes the secure foundation for the EV Charging Analytics PWA. It integrates Supabase for identity management and data storage, enforcing a private, single-user architecture through PostgreSQL Row-Level Security (RLS).

## 2. Authentication Design
- **Provider:** Supabase Auth (GoTrue).
- **Strategy:** Email and Password.
- **Access Control:** 
    - Public signups MUST be disabled in the Supabase dashboard.
    - The primary user account is created manually via the Supabase console.
- **Session Management:**
    - Persistent sessions (remember-me behavior) stored in the browser.
    - Auth state handled via a React Context (`AuthProvider`) and a custom `useAuth` hook.

## 3. Database Schema (PostgreSQL)

### 3.1. Tables

#### `providers`
Tracks charging network providers (e.g., Ionity, EnBW).
- `id`: UUID (Primary Key)
- `user_id`: UUID (FK to auth.users)
- `name`: Text
- `created_at`: Timestamptz

#### `tariffs`
Defines price rules for a provider.
- `id`: UUID (Primary Key)
- `user_id`: UUID (FK to auth.users)
- `provider_id`: UUID (FK to providers.id)
- `tariff_name`: Text
- `ac_price_per_kwh`: Integer (cents)
- `dc_price_per_kwh`: Integer (cents)
- `session_fee`: Integer (cents)
- `valid_from`: Timestamptz
- `valid_to`: Timestamptz (Nullable)
- `created_at`: Timestamptz

#### `charging_sessions`
Records individual charging events.
- `id`: UUID (Primary Key)
- `user_id`: UUID (FK to auth.users)
- `session_timestamp`: Timestamptz
- `provider_id`: UUID (FK to providers.id)
- `tariff_id`: UUID (FK to tariffs.id)
- `location_type`: Text (Enum: 'Home', 'Work', 'Public', 'Fast Charger')
- `charging_type`: Text (Enum: 'AC', 'DC')
- `kwh_billed`: Numeric(6,2)
- `kwh_added`: Numeric(6,2) (Optional, for efficiency tracking)
- `total_cost`: Integer (cents)
- `odometer_km`: Integer (Nullable)
- `start_soc`: Integer (0-100)
- `end_soc`: Integer (0-100)
- `notes`: Text (Nullable)
- **Snapshots:**
    - `applied_ac_price`: Integer (cents)
    - `applied_dc_price`: Integer (cents)
    - `applied_session_fee`: Integer (cents)

### 3.2. Row-Level Security (RLS)
- **Mandatory:** `ALTER TABLE [name] ENABLE ROW LEVEL SECURITY;`
- **Policy:** `CREATE POLICY "User ownership" ON [name] FOR ALL USING (auth.uid() = user_id);`
- **Default:** Deny all if not authenticated or not the owner.

## 4. Frontend Infrastructure
- **Supabase Client:** Singleton exported from `src/lib/supabase.ts`.
- **Environment:** Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **Auth Provider:** Wraps the application to provide `user` and `session` state.
- **Login UI:** A dedicated feature component (`src/features/auth/components/LoginForm.tsx`) using Tailwind CSS.

## 5. Success Criteria
1. User can securely log in via email/password.
2. Unauthenticated users are redirected/presented with the login form.
3. Database schema is correctly applied with RLS policies verified.
4. Attempting to access data without a valid session (or from a different user) results in a PostgreSQL error or empty result set.

## 6. Future Considerations
- Support for "Blocking Fees" (Option B in brainstorming) can be added as a JSONB `metadata` column in `tariffs`.
- Passive Battery Health calculation will be implemented as a PostgreSQL View in Phase 5.
