# ADR 007: Cloudflare Workers with Static Assets

## Status

Accepted

## Date

2026-07-03

## Supersedes

[ADR 003: Cloudflare Pages for Hosting](./003-cloudflare-pages.md)

## Context

ADR 003 selected Cloudflare Pages for a static React SPA. The application now uses the Cloudflare Vite plugin, a version-controlled `wrangler.jsonc`, and Wrangler commands for local preview and production deployment. The documented Pages workflow no longer describes the deployed system.

The application remains a client-rendered, offline-first SPA. It needs static asset delivery, HTTPS, and SPA route fallback so direct navigation and browser refreshes resolve to the application shell. Supabase continues to provide authentication and remote persistence; no application backend is being moved into the hosting layer by this decision.

## Decision

Deploy EV Analytics to Cloudflare Workers with Static Assets through Wrangler.

- Use `@cloudflare/vite-plugin` in `vite.config.ts` for the Cloudflare build integration.
- Keep deployment configuration in `wrangler.jsonc`.
- Configure `assets.not_found_handling` as `single-page-application` so client-side routes fall back to the SPA entry point.
- Use `npm run preview` for a built local Wrangler preview and `npm run deploy` for production deployment.
- Provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vite build environment because Vite embeds these public client settings at build time.
- Keep Supabase as the authenticated remote data service and preserve Dexie as the offline-first local data store.

## Rationale

- **Configuration as code:** Hosting behavior and compatibility settings are reviewed with the application instead of being defined only in a provider dashboard.
- **Deployment parity:** Local preview and production deployment use the same Wrangler configuration and Cloudflare integration.
- **SPA routing:** The static-assets configuration explicitly supports direct navigation to client-side routes.
- **Operational simplicity:** The existing npm scripts provide one repeatable build-and-deploy path for this private application.
- **Platform continuity:** The application retains Cloudflare's edge delivery and security capabilities without maintaining a separate Pages configuration.

## Consequences

- Production deployment requires authenticated Wrangler access to the target Cloudflare account.
- CI or a maintainer machine must make the Vite Supabase variables available before the production build.
- Deployment is explicit through Wrangler; Pages-specific Git integration, build settings, and preview behavior are no longer part of the architecture.
- Changes to `wrangler.jsonc`, the Cloudflare Vite plugin, or deployment scripts are hosting architecture changes and must be reflected in this ADR and `docs/infrastructure-runbook.md`.
- The hosting layer can support Worker capabilities, but adding server-side application behavior requires a separate architectural decision.
