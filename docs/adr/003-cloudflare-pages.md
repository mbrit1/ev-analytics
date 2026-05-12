# ADR 003: Cloudflare Pages for Hosting

## Status
Accepted

## Context
We need a hosting platform that is fast, secure, and integrates well with our GitHub workflow.

## Decision
We will host the production build on **Cloudflare Pages**.

## Rationale
*   **Performance:** Cloudflare's global edge network ensures fast loading times worldwide.
*   **CI/CD:** Automatic builds and previews for every branch/pull request.
*   **Cost:** Extremely generous free tier for personal projects.
*   **Security:** Built-in SSL and DDoS protection.
*   **Static Assets:** Perfect for our React SPA + PWA architecture.

## Consequences
*   Environment variables (like Supabase keys) must be configured in the Cloudflare dashboard.
*   Backend logic must be handled either by Supabase or Cloudflare Workers (if needed later).
