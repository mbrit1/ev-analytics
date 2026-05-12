# ADR 001: React SPA (Client-side)

## Status
Accepted

## Context
The application is intended for a single user to track EV charging sessions and tariffs. It must be highly resilient to poor or non-existent network conditions (e.g., in underground parking garages).

## Decision
We will build the application as a client-side React Single Page Application (SPA).

## Rationale
*   **Offline-First:** An SPA allows the entire application logic to be loaded into the client's browser/device once. Subsequent interactions do not require server round-trips for routing or logic.
*   **Complexity:** A full-stack framework like Next.js with SSR/ISR adds unnecessary complexity for a single-user application where SEO is not a requirement.
*   **Static Hosting:** An SPA can be hosted on simple static hosting providers (Cloudflare Pages), reducing cost and maintenance.
*   **PWA Compatibility:** SPAs are the natural architecture for Progressive Web Apps, which we require for iOS/Android home screen installation.

## Consequences
*   Initial load might be slightly larger, but subsequent performance is near-instant.
*   All data persistence logic must be implemented in the client (using Dexie/IndexedDB) with a background sync strategy.
