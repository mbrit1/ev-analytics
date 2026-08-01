# Infrastructure Runbook

This runbook covers local environment setup, first-time Supabase provisioning, and production deployment for EV Analytics. It is intended for project maintainers with access to the private Supabase and Cloudflare accounts.

## Prerequisites

- Node.js 22.20.0 or newer; the repository version is recorded in `.nvmrc`
- npm
- A Supabase account with permission to create and configure a project
- A Cloudflare account with permission to deploy the application

Never commit `.env.local`, Supabase credentials, or Cloudflare credentials.

## Local Development

1. Select the repository's Node.js version and install dependencies:

   ```bash
   nvm use
   npm install
   ```

2. Copy `.env.example` to `.env.local` and provide the Supabase project values:

   ```env
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Before handing off changes, run the standard verification gate:

   ```bash
   npm run lint && npm run test -- --run && npm run build
   ```

## Provision Supabase

Use a new or empty Supabase project for the clean import path below. `supabase/schema.sql` is the canonical remote schema, not an incremental migration.

1. Create the Supabase project.
2. In **Authentication > Providers > Email**, disable public user signup. The application is private and does not expose a registration flow.
3. Open the SQL Editor and run `supabase/schema.sql` as one execution.
4. Verify that these tables exist:
   - `providers`
   - `charging_plans`
   - `provider_plan_selections`
   - `charging_sessions`
5. Verify that RLS is enabled on all four tables and that their policies restrict access with `auth.uid() = user_id`.
6. In **Authentication > Users**, create the application user manually.
7. Copy the project URL and publishable key from the Supabase project settings into the local or deployment environment.

Do not run `supabase/seed.sql` in production. It is development-only fixture data and requires an existing authenticated user.

## Validate Supabase Access

After configuring `.env.local`:

1. Start the application with `npm run dev`.
2. Sign in with the manually created user.
3. Confirm that the initial application data loads.
4. Create or edit a record, then confirm that it appears locally and eventually reaches Supabase after synchronization.
5. Confirm in Supabase that the stored row uses the authenticated user's ID.

If sign-in works but data access fails, check RLS and the row's `user_id` before changing application code.

### Verify RLS authorization boundaries

Run the RLS verifier only against a disposable Supabase test project. It creates and removes probes for two test users and must never be aimed at production. After supplying the listed environment variables through a trusted shell or secret manager, run:

```bash
node scripts/verify-rls-live.mjs
```

The verifier uses `SUPABASE_URL`, one publishable/anon key (`SUPABASE_KEY`, `SUPABASE_ANON_KEY`, or `VITE_SUPABASE_PUBLISHABLE_KEY`), plus `RLS_USER1_EMAIL`, `RLS_USER1_PASSWORD`, `RLS_USER2_EMAIL`, and `RLS_USER2_PASSWORD`. It checks owner CRUD, anonymous and cross-user denial, spoofed ownership, and ownership-scoped foreign keys for all domain tables. It cannot prove the policies deployed to a different project; run it separately against each disposable deployment under review.

## Production Active-Tariff Preflight (Read Only)

This section is an audit procedure, not a migration. Do not claim production is
clean without running these read-only queries in the intended project and
reviewing their result. Never run `scripts/verify-rls-live.mjs` against
production: it creates and removes test data.

Before a separately approved paid-tariff constraint rollout, run both audits
with a suitably authorized read-only connection. No automatic repair is
approved. Any data repair requires separate approval, after which both audits
must be rerun before a separately approved constraint rollout. The checked-in
`supabase/schema.sql` remains a clean baseline, not an incremental migration
for an existing project.

### 1. Overlapping active positive-fee charging plans

This query uses the generated half-open `valid_period` and an ordered pair of
UUIDs so every conflicting pair appears once, deterministically.

```sql
SELECT
  earlier.user_id,
  earlier.provider_id,
  earlier.id AS earlier_plan_id,
  earlier.name AS earlier_plan_name,
  earlier.monthly_base_fee AS earlier_monthly_base_fee,
  earlier.valid_period AS earlier_valid_period,
  later.id AS later_plan_id,
  later.name AS later_plan_name,
  later.monthly_base_fee AS later_monthly_base_fee,
  later.valid_period AS later_valid_period
FROM public.charging_plans AS earlier
JOIN public.charging_plans AS later
  ON later.user_id = earlier.user_id
  AND later.provider_id = earlier.provider_id
  AND earlier.id < later.id
  AND later.valid_period && earlier.valid_period
WHERE earlier.deleted_at IS NULL
  AND later.deleted_at IS NULL
  AND earlier.monthly_base_fee > 0
  AND later.monthly_base_fee > 0
ORDER BY earlier.user_id, earlier.provider_id, earlier.id, later.id;
```

### 2. Ad-hoc sessions that exactly match an applicable saved tariff (heuristic)

This heuristic identifies active ad-hoc sessions whose billing-provider
snapshot, after trimming and case-folding, exactly matches a non-deleted
same-user provider with any non-deleted plan containing the session's UTC date.
It is an audit lead, not proof that a historical ad-hoc receipt was incorrect.

```sql
SELECT
  session.id AS session_id,
  session.user_id,
  session.session_timestamp,
  (session.session_timestamp AT TIME ZONE 'UTC')::date AS session_utc_date,
  session.provider_name_snapshot,
  provider.id AS matched_provider_id,
  provider.name AS matched_provider_name
FROM public.charging_sessions AS session
JOIN public.providers AS provider
  ON provider.user_id = session.user_id
  AND provider.deleted_at IS NULL
  AND lower(trim(provider.name)) = lower(trim(session.provider_name_snapshot))
WHERE session.deleted_at IS NULL
  AND session.session_mode = 'ad_hoc'
  AND EXISTS (
    SELECT 1
    FROM public.charging_plans AS plan
    WHERE plan.user_id = session.user_id
      AND plan.provider_id = provider.id
      AND plan.deleted_at IS NULL
      AND plan.valid_period @> (session.session_timestamp AT TIME ZONE 'UTC')::date
  )
ORDER BY session.user_id, session.session_timestamp, session.id;
```

### Inspect deployed constraints

Inspect the deployed `charging_plans` constraints before planning a rollout:

```sql
SELECT
  constraint_name,
  pg_get_constraintdef(constraint_oid) AS definition
FROM (
  SELECT conname AS constraint_name, oid AS constraint_oid
  FROM pg_constraint
  WHERE conrelid = 'public.charging_plans'::regclass
  ORDER BY conname
) AS constraints;
```

### Reviewed constraint example — DO NOT RUN without approval

The following is a reviewed target shape for a separately approved migration
after the audits are clean and the existing constraint names have been
inspected. It changes production schema and can fail or lock while validating
existing data; do not run it without explicit approval and a migration plan.

```sql
ALTER TABLE public.charging_plans
  ADD CONSTRAINT charging_plans_no_overlapping_paid_provider_versions
  EXCLUDE USING gist (
    user_id WITH =,
    provider_id WITH =,
    valid_period WITH &&
  )
  WHERE (deleted_at IS NULL AND monthly_base_fee > 0);
```

## Production Provider-Name Index Rollout

`supabase/schema.sql` is a clean-import baseline. Do not run it against an
existing project. The checked-in SQL and this procedure are not authorization
to change production; production execution requires separate explicit
authorization.

### 1. Read-only aggregate preflight

Immediately before a separately authorized rollout, run this query with a
suitably authorized read-only connection. It returns counts only. If any count
is non-zero, stop: do not run the replacement DDL. Prepare a separately
reviewed data-repair plan, complete it under its own authorization, and rerun
this preflight.

```sql
WITH active_providers AS (
  SELECT user_id, name
  FROM public.providers
  WHERE deleted_at IS NULL
),
normalized_duplicates AS (
  SELECT user_id, lower(btrim(name)) AS normalized_name
  FROM active_providers
  GROUP BY user_id, lower(btrim(name))
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) FILTER (WHERE name <> btrim(name))
    AS names_with_surrounding_whitespace,
  COUNT(*) FILTER (WHERE btrim(name) = '')
    AS names_blank_after_trim,
  (SELECT COUNT(*) FROM normalized_duplicates)
    AS normalized_duplicate_groups
FROM active_providers;
```

### 2. Reviewed transactional replacement DDL — DO NOT RUN without separate authorization

Run this reviewed incremental replacement only after the aggregate preflight
returns zero for every count and a production change is separately authorized.
It creates the stronger index before dropping the old one, then restores the
canonical final name in the same transaction. If any statement fails, stop and
investigate; do not attempt an ad-hoc repair or rerun individual statements.

```sql
BEGIN;

CREATE UNIQUE INDEX providers_user_name_active_unique_replacement
  ON public.providers(user_id, lower(btrim(name)))
  WHERE deleted_at IS NULL;

DROP INDEX public.providers_user_name_active_unique;

ALTER INDEX public.providers_user_name_active_unique_replacement
  RENAME TO providers_user_name_active_unique;

COMMIT;
```

### 3. Read-only postflight

After the authorized transaction commits, run both read-only checks in the
target project. The first must return the exact active-provider index
definition below; the second must return zero. If either result differs, stop
and prepare a separately reviewed repair plan before any further schema work.

```sql
SELECT pg_get_indexdef('public.providers_user_name_active_unique'::regclass);
```

Expected definition:

```sql
CREATE UNIQUE INDEX providers_user_name_active_unique
  ON public.providers USING btree (user_id, lower(btrim(name)))
  WHERE (deleted_at IS NULL)
```

```sql
SELECT COUNT(*) AS normalized_duplicate_groups
FROM (
  SELECT user_id, lower(btrim(name)) AS normalized_name
  FROM public.providers
  WHERE deleted_at IS NULL
  GROUP BY user_id, lower(btrim(name))
  HAVING COUNT(*) > 1
) AS normalized_duplicates;
```

## Deploy to Cloudflare

The application is deployed with Wrangler using the configuration in `wrangler.jsonc`. The `npm run deploy` command builds the Vite application before running `wrangler deploy`.

1. Authenticate Wrangler for the target Cloudflare account:

   ```bash
   npx wrangler login
   ```

2. Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are available to the build, either through `.env.local` on a trusted maintainer machine or through protected CI environment variables.
3. Run the standard verification gate:

   ```bash
   npm run lint && npm run test -- --run && npm run build
   ```

4. Deploy:

   ```bash
   npm run deploy
   ```

5. Open the deployed URL reported by Wrangler and verify:
   - the SPA loads on a direct route and after refresh;
   - authentication succeeds;
   - existing data loads;
   - an offline local write remains available after reload; and
   - the queued write synchronizes after connectivity returns.

### Deployment security headers

The Vite build emits a Cloudflare Workers Static Assets `_headers` file from
[`scripts/security-headers.mjs`](../scripts/security-headers.mjs). This is the
Workers-supported static-asset mechanism, so the policy applies to the root
document, static PWA assets, and SPA fallback responses without adding a custom
Worker request handler. It sets a restrictive Content Security Policy with the
build's exact `VITE_SUPABASE_URL` origin in `connect-src`, plus anti-framing,
MIME-sniffing, referrer, and permissions protections. The build requires an
absolute HTTPS Supabase URL for this policy.

HSTS is intentionally not emitted by the repository because its domain scope
and preload suitability must be decided for the deployed Cloudflare hostname(s).
Before enabling it in Cloudflare, verify the target custom-domain and
`workers.dev` exposure policy, HTTPS-only availability, and any subdomain
impact. After deployment, inspect response headers on both `/` and a direct SPA
route to confirm Cloudflare is serving the emitted policy.

## Troubleshooting

### Missing Supabase configuration

The application requires both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` outside mock mode. Restart the development server after changing `.env.local`.

### Authentication succeeds but queries return no rows

Confirm that the rows belong to the signed-in user and that each table's RLS policies compare `auth.uid()` with `user_id`.

### Schema import fails

The checked-in schema is a clean import baseline. Do not apply it over an existing production schema without reviewing the statements and planning a migration.

### Deployment uses the wrong backend

Vite embeds `VITE_*` variables at build time. Confirm the values available to the build, rebuild, and deploy again.

## Related Documentation

- [README](../README.md): project overview and development commands
- [Contributor guide](../CONTRIBUTING.md): human engineering workflow and conventions
- [Current architecture](./architecture.md): implemented data flow, persistence, and synchronization behavior
- [Coding-agent instructions](../AGENTS.md): durable repository constraints for coding agents
- [ADR 004](./adr/004-supabase-auth-and-rls.md): authentication and RLS decision
- [ADR 005](./adr/005-outbox-sync-strategy.md): offline synchronization decision
