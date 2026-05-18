# Design Specification: Design System Sandbox v2.0 Migration

**Date:** 2026-05-16  
**Status:** Draft  
**Topic:** Migration of EV Analytics UI to the "Sandbox v2.0" design paradigm.

## 1. Overview

This specification details the migration of the EV Analytics application to the "Design System Sandbox v2.0" aesthetic. The goal is to achieve a minimalist, high-impact "Look and Feel" (Apple-inspired) while maintaining the existing React/Tailwind/Supabase tech stack and offline-first functionality.

## 2. Goals & Success Criteria

- **Visual Fidelity:** Match the typography, color palette, and component spacing of `design-migration/Design-System-Sandbox-v2.0.html`.
- **Zero-Typing UX:** Implement "Tactile Matrix" grids for common toggles (AC/DC, Location Types).
- **High-Impact Inputs:** Migrate all numeric data entry to the "Thin Underline" paradigm with large (`36px`) typography.
- **Accessibility:** Ensure all new components maintain WCAG AA compliance (semantic HTML, focus states, min 44x44pt hit areas).
- **Performance:** No regression in TTI or bundle size.

## 3. Technical Strategy: "Token-First Hybrid"

We will use Tailwind v4's "CSS-First" token system. Instead of JS configuration, we will define our theme in `src/index.css` using CSS variables that Tailwind v4 automatically exposes as utility classes.

### 3.1 Token Mapping (`src/index.css`)

| Variable | Value (Light) | Value (Dark) | Tailwind Class |
| :--- | :--- | :--- | :--- |
| `--color-environment` | `#F5F5F7` | `#000000` | `bg-environment` |
| `--color-surface` | `#FFFFFF` | `#1C1C1E` | `bg-surface` |
| `--color-accent` | `#007AFF` | `#007AFF` | `bg-accent` / `text-accent` |
| `--text-primary` | `#1D1D1F` | `#F5F5F7` | `text-primary` |
| `--text-secondary` | `#86868B` | `#8E8E93` | `text-secondary` |
| `--shadow-slab` | `0 10px 30px rgba(0,0,0,0.04)` | `0 10px 40px rgba(0,0,0,0.3)` | `shadow-slab` |
| `--radius-slab` | `28px` | `28px` | `rounded-slab` |

## 4. Component Architecture

### 4.1 Floating Slabs (Containers)

All primary content modules (Forms, History cards, Summary widgets) will be wrapped in a `Slab` component.

- **Base Style:** `bg-surface border border-secondary/10 rounded-slab shadow-slab p-8 transition-colors duration-300`.

### 4.2 Thin Underline Inputs

Refactor existing form inputs to use the high-impact style.

- **Typography:** `text-4xl` (36px), `font-medium`, `tabular-nums`.
- **Border:** `border-b border-secondary/20 focus:border-accent focus:opacity-100`.
- **Validation:** `border-red-500` for errors, with minimal error text below the underline.
- **Unit Suffix:** A `span` with `text-lg text-secondary font-medium ml-2` (e.g., "€", "kWh").

### 4.3 Tactile Matrix (Zero-Typing Grid)

A reusable component for selection groups.

- **Semantic:** Built on `input[type="radio"]` (hidden with `sr-only`).
- **Visual:** A grid/row of nodes styled as buttons.
- **Active State:** `bg-primary text-surface font-semibold`.
- **Idle State:** `bg-secondary/10 text-primary hover:bg-secondary/20`.
- **Hit Area:** Minimum `44px` height.

## 5. UI Shell & Navigation

- **App Wrapper:** `bg-environment min-h-screen text-primary`.
- **Navigation:** Simplify the bottom bar to use the new tokens and potentially a more minimalist icon style that matches the Sandbox.
- **Header:** Transparent or thin-line header that lets the content "slabs" take center stage.

## 6. Testing & Validation

- **Visual Regression:** Manually verify against the Sandbox HTML.
- **Accessibility:** Keyboard navigation through the Tactile Matrix; Screen reader labels for the Thin Underline inputs.
- **Dark Mode:** Verify theme switching and token consistency.
