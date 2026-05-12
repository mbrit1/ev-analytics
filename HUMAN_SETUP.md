# Human Setup Guide

This document lists the manual steps required to set up the EV Analytics infrastructure.

## 1. Supabase Setup

1. Create a new project on [Supabase](https://app.supabase.com/).
2. **Disable Public Signups:**
   - Go to **Authentication** > **Providers** > **Email**.
   - Disable "Allow new users to sign up".
   - This ensures the app remains single-user and private.
3. **Database Setup:**
   - The SQL schema will be provided in Phase 2. You will need to run it in the SQL Editor.
4. **Environment Variables:**
   - Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the `.env.local` file.

## 2. Cloudflare Pages Setup

1. Connect your GitHub repository to Cloudflare Pages.
2. Build Settings:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Environment Variables:
   - Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Cloudflare dashboard.

## 3. PWA Assets

1. Generate app icons (192x192, 512x512, and Apple Touch Icon).
2. Place them in the `public/` directory as specified in the `vite-plugin-pwa` configuration (Phase 1).

## 4. Initial User Creation

1. Since public signup is disabled, manually create your user account in the Supabase **Authentication** > **Users** dashboard.
