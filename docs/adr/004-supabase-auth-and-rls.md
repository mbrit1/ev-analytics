# ADR 004: Supabase Auth and Row-Level Security (RLS)

## Status

Proposed

## Context

The application is designed for single-user use but requires secure data storage and authentication. We need a way to ensure that only the authenticated owner can access and modify their data, even if the database is technically shared (in a Supabase project).

## Decision

We will use Supabase Auth for user management and PostgreSQL Row-Level Security (RLS) to enforce data privacy.

1.  **Authentication:**
    *   Use Supabase's built-in Email/Password authentication.
    *   Disable public signups via the Supabase dashboard to keep the app private.
    *   The user will be manually created by the owner.
2.  **Row-Level Security (RLS):**
    *   Enable RLS on all tables (`providers`, `tariffs`, `charging_sessions`).
    *   Implement a `user_id` column in each table (referencing `auth.users.id`).
    *   Create RLS policies that restrict `SELECT`, `INSERT`, `UPDATE`, and `DELETE` operations to the authenticated user whose `id` matches the `user_id` in the row.
    *   Default policy for all tables will be "Deny All" unless the user is authenticated and owns the data.

## Consequences

*   **Security:** Provides strong, database-level assurance that data remains private to the user.
*   **Simplicity:** Leverages built-in Supabase features, reducing custom backend logic.
*   **Single-User Focus:** Aligns with the private, personal nature of the app.
*   **Implementation Effort:** Requires adding `user_id` to all tables and writing RLS policies.
