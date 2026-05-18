# Design Spec: Responsive Navigation (Mobile vs Desktop)

## 1. Problem Statement
The current application uses an iOS-style bottom tab bar for all viewports. While ideal for mobile, this is a navigation anti-pattern on desktop, where a sidebar or top navigation is expected.

## 2. Goal
Implement a responsive navigation system that provides:
- A **Bottom Tab Bar** for mobile viewports (< 768px).
- A **Toggleable Left Sidebar** for desktop viewports (>= 768px).

## 3. Requirements

### 3.1. Navigation Items
- **Sessions:** Navigates to the charging history view.
- **Tariffs:** Navigates to the tariff management view.

### 3.2. Mobile Navigation (Bottom Bar)
- Sticky to the bottom.
- 44px minimum hit area for buttons.
- Supports iOS safe area insets.
- Backdrop blur (`bg-surface/90 backdrop-blur-lg`).

### 3.3. Desktop Navigation (Sidebar)
- **Rail Mode (Collapsed):** 72px width, icons only.
- **Full Mode (Expanded):** 240px width, icons + text labels.
- **Toggle:** A button at the bottom of the sidebar to switch between Rail and Full modes.
- **Persistence:** The user's preference for Rail vs. Full mode should be saved in `localStorage`.
- **Transitions:** Smooth width and opacity transitions (300ms).

### 3.4. Layout Integration (`App.tsx`)
- On desktop, the header and main content must be shifted to the right to accommodate the sidebar.
- The `max-w-[1024px]` content constraint should be preserved within the main content area.

## 4. Architecture

### 4.1. Components
- `src/components/ui/Navigation/Navigation.tsx`: Responsive container.
- `src/components/ui/Navigation/Sidebar.tsx`: Desktop sidebar implementation.
- `src/components/ui/Navigation/BottomNav.tsx`: Mobile bottom bar implementation.

### 4.2. State Management
- `activeTab`: Managed in `App.tsx` and passed via props.
- `isSidebarCollapsed`: Managed within `Sidebar.tsx` (or `Navigation.tsx`) and persisted to `localStorage`.

## 5. UI & Styling
- Use existing Tailwind tokens (`surface`, `accent`, `secondary`, `primary`).
- Match the "Tactile" and "Slab" design language from the v2.0 Sandbox.
- Ensure high contrast for active states.

## 6. Accessibility (WCAG AA)
- Semantic `<nav>` landmark.
- Proper `aria-label` for all navigation buttons.
- Keyboard navigation (Tab through items, Enter/Space to select).
- Tooltips or clear labels for Rail mode icons.

## 7. Success Criteria
- [ ] Navigation switches seamlessly at the 768px breakpoint.
- [ ] Sidebar toggle works and persists across sessions.
- [ ] Content layout remains centered and readable on all screen sizes.
- [ ] All interactive elements meet 44x44pt hit area requirements.
