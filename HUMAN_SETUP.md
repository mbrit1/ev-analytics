# Human Setup Guide

This document lists the manual steps required to set up the EV Analytics infrastructure. They are organized by the project phase when they are needed.

## Phase 1: Foundation & Scaffolding

### 1. PWA Assets

* **Action:** Generate app icons (192x192, 512x512, and Apple Touch Icon).
* **Action:** Place them in the `public/` directory. We will configure `vite-plugin-pwa` to look for these files.

## Phase 2: Core Infrastructure (Auth & Database)

### 1. Supabase Setup

1. Create a new project on [Supabase](https://app.supabase.com/).
2. **Disable Public Signups:**
   * Go to **Authentication** > **Providers** > **Email**.
   * Disable "Allow new users to sign up".
   * This ensures the app remains single-user and private.
3. **Database Setup:**
   * The SQL schema will be generated during Phase 2. You will need to copy it and run it in the Supabase SQL Editor.
4. **Environment Variables:**
   * Copy `Project URL` and the **Publishable key** (starts with `sb_publishable_`).
   * Create a `.env.local` file in the root of this project and add them:

     ```env
     VITE_SUPABASE_URL=your_url
     VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
     ```

### 2. Initial User Creation

1. Since public signup is disabled, manually create your user account in the Supabase **Authentication** > **Users** dashboard.

## Phase 7: Deployment & Documentation

### 1. Cloudflare Pages Setup

1. Connect your GitHub repository to Cloudflare Pages.
2. Build Settings:
   * Framework preset: `Vite`
   * Build command: `npm run build`
   * Build output directory: `dist`
3. Environment Variables:
   * Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Cloudflare dashboard.
