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

- `README.md`: project overview, architecture rules, and development commands
- `AGENTS.md`: repository workflow and engineering conventions
- `docs/adr/004-supabase-auth-and-rls.md`: authentication and RLS decision
- `docs/adr/005-outbox-sync-strategy.md`: offline synchronization decision
