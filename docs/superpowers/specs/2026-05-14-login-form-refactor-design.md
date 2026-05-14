# LoginForm Refactor Design Spec

**Goal:** Refactor `LoginForm.tsx` to use `react-hook-form` and `zod` while improving mobile accessibility and maintaining WCAG AA standards.

**Architecture:**
- **Validation**: Zod schema for `email` and `password`.
- **Form Management**: `react-hook-form` with `zodResolver`.
- **UI**: Tailwind CSS for styling, specifically `py-3` for inputs/buttons to meet 44px hit area requirement.
- **Auth**: Supabase `signInWithPassword`.

**Accessibility Standards:**
- Semantic HTML (`main`, `form`, `label`, `input`, `button`).
- `aria-invalid` for inputs with errors.
- `role="alert"` for form-level errors.
- `sr-only` for loading states.
- 44x44pt minimum hit area for interactive elements.

**Component Structure:**
- `LoginForm`: The main component containing the form logic and UI.
- `loginSchema`: Zod schema for form validation.
- `LoginFormValues`: TypeScript type inferred from the Zod schema.
