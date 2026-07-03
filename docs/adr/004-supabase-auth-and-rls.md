# ADR 004: Supabase Auth and Row-Level Security (RLS)

## Status

Accepted

## Date

2026-05-14

## Last updated

2026-07-03

## Context

The application is designed for private, single-user use but requires secure data storage and authentication. Only the authenticated owner may access or modify application data, even though the database is hosted in a shared Supabase environment.

## Decision

We use Supabase Auth for user management and PostgreSQL Row-Level Security (RLS) to enforce data ownership and privacy.

1. **Authentication:**
   - Use Supabase's built-in email and password authentication.
   - Disable public signups in Supabase to keep account creation private.
   - Create the application user manually through Supabase Authentication.
2. **Row-Level Security:**
   - Enable RLS on `providers`, `charging_plans`, `provider_plan_selections`, and `charging_sessions`.
   - Require every domain row to have a non-null `user_id` referencing `auth.users(id)`.
   - Permit authenticated operations only when `auth.uid() = user_id`, using both `USING` and `WITH CHECK` where the operation requires them.
   - Keep anonymous access and access to another user's rows denied by the absence of permissive policies.
   - Operation-specific policies may be used when a table requires separate `SELECT`, `INSERT`, `UPDATE`, and `DELETE` rules, as with `provider_plan_selections`, provided they preserve the same ownership constraint.

The domain model has evolved from the original `tariffs` table to charging plans and provider plan selections. This updates the tables governed by the decision without changing the authentication or ownership model.

## Consequences

- **Security:** Database-level policies protect data even if application-layer checks fail.
- **Simplicity:** Supabase Auth and PostgreSQL RLS avoid a custom authorization service.
- **Single-user focus:** The model preserves the private, personal posture of the application while retaining an explicit ownership boundary.
- **Schema discipline:** Every new domain table must include an ownership column, enable RLS, and define ownership-scoped policies before it is used by the application.
- **Operational dependency:** Public signup remains a Supabase dashboard setting and must be verified when provisioning an environment.
