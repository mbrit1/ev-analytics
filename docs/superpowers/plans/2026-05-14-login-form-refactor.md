# LoginForm Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `LoginForm.tsx` to use `react-hook-form` and `zod` for validation and improve mobile accessibility.

**Architecture:** React Hook Form + Zod + Supabase Auth.

**Tech Stack:** React, TypeScript, React Hook Form, Zod, Tailwind CSS, Supabase.

---

### Task 1: Refactor LoginForm to use react-hook-form and Zod

**Files:**
- Modify: `src/features/auth/components/LoginForm.tsx`

- [ ] **Step 1: Define Zod schema and types**
- [ ] **Step 2: Initialize useForm with zodResolver**
- [ ] **Step 3: Update JSX to use register and handleSubmit**
- [ ] **Step 4: Update CSS classes for 44px hit area (py-3)**
- [ ] **Step 5: Ensure accessibility attributes are present**
- [ ] **Step 6: Verify implementation by running lint and build**

---

### Task 2: Verification

- [ ] **Step 1: Check build**
Run: `npm run build`
Expected: Success

- [ ] **Step 2: Check lint**
Run: `npm run lint`
Expected: Success
