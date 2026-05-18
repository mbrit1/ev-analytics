# Responsive Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a responsive navigation system that uses a bottom tab bar on mobile and a toggleable sidebar on desktop.

**Architecture:** We will create a `Navigation` component directory containing `BottomNav` (mobile), `Sidebar` (desktop), and `Navigation` (responsive wrapper). `App.tsx` will be refactored to use this new component and adjust its main layout container to accommodate the sidebar.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react.

---

### Task 1: Implement `BottomNav` Component

**Files:**
- Create: `src/components/ui/Navigation/BottomNav.tsx`
- Create: `src/components/ui/Navigation/BottomNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/Navigation/BottomNav.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('renders navigation items and handles clicks', () => {
    const onTabChange = vi.fn()
    render(<BottomNav activeTab="sessions" onTabChange={onTabChange} />)
    
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Tariffs')).toBeInTheDocument()
    
    fireEvent.click(screen.getByText('Tariffs'))
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/ui/Navigation/BottomNav.test.tsx --run`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Write implementation**

```tsx
// src/components/ui/Navigation/BottomNav.tsx
import { History, Receipt } from 'lucide-react'

interface BottomNavProps {
  activeTab: 'sessions' | 'tariffs'
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-lg border-t border-secondary/10 px-6 py-3 pb-[env(safe-area-inset-bottom,24px)] md:hidden flex justify-around items-center z-10">
      <button
        onClick={() => onTabChange('sessions')}
        className={`flex flex-col items-center gap-1 transition-colors min-h-[44px] min-w-[44px] justify-center ${
          activeTab === 'sessions' ? 'text-accent' : 'text-secondary hover:text-primary'
        }`}
        aria-label="Sessions"
      >
        <History className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Sessions</span>
      </button>
      <button
        onClick={() => onTabChange('tariffs')}
        className={`flex flex-col items-center gap-1 transition-colors min-h-[44px] min-w-[44px] justify-center ${
          activeTab === 'tariffs' ? 'text-accent' : 'text-secondary hover:text-primary'
        }`}
        aria-label="Tariffs"
      >
        <Receipt className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Tariffs</span>
      </button>
    </nav>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/ui/Navigation/BottomNav.test.tsx --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Navigation/BottomNav.tsx src/components/ui/Navigation/BottomNav.test.tsx
git commit -m "feat(nav): implement mobile BottomNav component"
```

---

### Task 2: Implement `Sidebar` Component

**Files:**
- Create: `src/components/ui/Navigation/Sidebar.tsx`
- Create: `src/components/ui/Navigation/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/Navigation/Sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders navigation items and toggles rail mode', () => {
    const onTabChange = vi.fn()
    render(<Sidebar activeTab="sessions" onTabChange={onTabChange} />)
    
    // Check initial render (should show text labels)
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    
    // Toggle to rail mode
    const toggleBtn = screen.getByLabelText('Toggle Sidebar')
    fireEvent.click(toggleBtn)
    
    // LocalStorage should be updated (mocked or implicitly tested if class changes, but we'll just check interaction)
    fireEvent.click(screen.getByLabelText('Navigate to Tariffs'))
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/ui/Navigation/Sidebar.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```tsx
// src/components/ui/Navigation/Sidebar.tsx
import { History, Receipt, ChevronLeft, ChevronRight, BatteryCharging } from 'lucide-react'
import { useState, useEffect } from 'react'

interface SidebarProps {
  activeTab: 'sessions' | 'tariffs'
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Load preference on mount
  useEffect(() => {
    const saved = localStorage.getItem('ev-sidebar-collapsed')
    if (saved === 'true') {
      setIsCollapsed(true)
    }
  }, [])

  const toggleSidebar = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('ev-sidebar-collapsed', String(newState))
  }

  return (
    <aside
      className={`hidden md:flex flex-col bg-surface/80 backdrop-blur-md border-r border-secondary/10 sticky top-0 h-screen transition-all duration-300 z-20 ${
        isCollapsed ? 'w-[72px]' : 'w-[240px]'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-center border-b border-secondary/10 shrink-0">
        <BatteryCharging className="w-8 h-8 text-accent shrink-0" />
        <span
          className={`font-bold tracking-tight text-primary ml-2 overflow-hidden transition-all duration-300 whitespace-nowrap ${
            isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          }`}
        >
          EV Analytics
        </span>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
        <button
          onClick={() => onTabChange('sessions')}
          aria-label="Navigate to Sessions"
          title={isCollapsed ? 'Sessions' : undefined}
          className={`flex items-center p-3 rounded-xl transition-colors min-h-[44px] ${
            activeTab === 'sessions'
              ? 'bg-accent/10 text-accent'
              : 'text-secondary hover:bg-secondary/10 hover:text-primary'
          }`}
        >
          <History className="w-6 h-6 shrink-0" />
          <span
            className={`font-bold ml-3 overflow-hidden transition-all duration-300 whitespace-nowrap ${
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            }`}
          >
            Sessions
          </span>
        </button>
        <button
          onClick={() => onTabChange('tariffs')}
          aria-label="Navigate to Tariffs"
          title={isCollapsed ? 'Tariffs' : undefined}
          className={`flex items-center p-3 rounded-xl transition-colors min-h-[44px] ${
            activeTab === 'tariffs'
              ? 'bg-accent/10 text-accent'
              : 'text-secondary hover:bg-secondary/10 hover:text-primary'
          }`}
        >
          <Receipt className="w-6 h-6 shrink-0" />
          <span
            className={`font-bold ml-3 overflow-hidden transition-all duration-300 whitespace-nowrap ${
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            }`}
          >
            Tariffs
          </span>
        </button>
      </nav>

      {/* Toggle Button */}
      <div className="p-3 border-t border-secondary/10 shrink-0">
        <button
          onClick={toggleSidebar}
          aria-label="Toggle Sidebar"
          className="flex items-center justify-center p-3 w-full rounded-xl text-secondary hover:bg-secondary/10 hover:text-primary transition-colors min-h-[44px]"
        >
          {isCollapsed ? <ChevronRight className="w-6 h-6 shrink-0" /> : <ChevronLeft className="w-6 h-6 shrink-0" />}
          <span
            className={`font-bold ml-3 overflow-hidden transition-all duration-300 whitespace-nowrap text-left ${
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            }`}
          >
            Collapse
          </span>
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/ui/Navigation/Sidebar.test.tsx --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Navigation/Sidebar.tsx src/components/ui/Navigation/Sidebar.test.tsx
git commit -m "feat(nav): implement responsive desktop Sidebar with rail mode"
```

---

### Task 3: Implement `Navigation` Wrapper

**Files:**
- Create: `src/components/ui/Navigation/Navigation.tsx`

- [ ] **Step 1: Write implementation**

```tsx
// src/components/ui/Navigation/Navigation.tsx
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

interface NavigationProps {
  activeTab: 'sessions' | 'tariffs'
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <>
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} />
      <BottomNav activeTab={activeTab} onTabChange={onTabChange} />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Navigation/Navigation.tsx
git commit -m "feat(nav): add Navigation wrapper component"
```

---

### Task 4: Refactor `App.tsx` Layout

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Modify implementation**

We will replace the bottom nav markup with the new `<Navigation>` component and wrap the main content in a flex container. We also remove the `EV Analytics` brand block from the mobile header since it's now in the sidebar on desktop (though we should keep it for mobile, so let's adjust the header to be `md:hidden` or just keep it). Actually, the spec says "On desktop, the header and main content must be shifted to the right". Since the sidebar has the brand, let's hide the top header entirely on desktop, or at least its brand part. The top header also has the Logout button. We should keep the Header on top but hide the brand on desktop, or just leave it. For simplicity, let's keep the Header on top and add left margin on desktop, OR put the Header inside the main flex-1 container.

Let's modify `src/App.tsx`:

```tsx
// Edit src/App.tsx
import { BatteryCharging, Loader2, LogOut, Plus } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth } from './features/auth/hooks/useAuth'
import { LoginForm } from './features/auth/components/LoginForm'
import { supabase } from './lib/supabase'
import { TariffList } from './features/tariffs/components/TariffList'
import { ChargingHistory } from './features/charging-sessions/components/ChargingHistory'
import { SessionForm } from './features/charging-sessions/components/SessionForm'
import { saveSession } from './features/charging-sessions/services/sessionService'
import { initialSync } from './features/offline-sync/services/syncEngine'
import { type ChargingSession } from './lib/db'
import { Navigation } from './components/ui/Navigation/Navigation'

function App() {
  const { user, loading } = useAuth()
  const [activeTab, setActiveTab] = useState<'sessions' | 'tariffs'>('sessions')
  const [isSessionFormOpen, setIsSessionFormOpen] = useState(false)

  useEffect(() => {
    if (user) {
      initialSync().catch(console.error);
    }
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const handleSessionSubmit = async (session: ChargingSession) => {
    await saveSession(session);
    setIsSessionFormOpen(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-environment">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="min-h-screen bg-environment flex md:flex-row flex-col">
      {/* Navigation (Sidebar on Desktop, BottomNav on Mobile) */}
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header (Hidden on Desktop since Sidebar has the brand) */}
        <header className="md:hidden bg-surface/80 backdrop-blur-md border-b border-secondary/10 sticky top-0 z-10">
          <div className="px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BatteryCharging className="w-6 h-6 text-accent" />
              <span className="font-bold tracking-tight text-primary">EV Analytics</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-secondary hover:text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Desktop Header (Only Logout button, right aligned) */}
        <header className="hidden md:flex bg-surface/80 backdrop-blur-md sticky top-0 z-10 border-b border-secondary/10">
           <div className="flex-1 max-w-[1024px] mx-auto px-6 h-16 flex items-center justify-end">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 p-2 text-secondary hover:text-primary transition-colors min-h-[44px]"
                aria-label="Sign Out"
              >
                <span className="font-bold">Sign Out</span>
                <LogOut className="w-5 h-5" />
              </button>
           </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-[1024px] w-full mx-auto p-4 pb-32 md:pb-8">
          {activeTab === 'tariffs' ? (
            <TariffList />
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-primary">Sessions</h1>
                {!isSessionFormOpen && (
                  <button
                    onClick={() => setIsSessionFormOpen(true)}
                    className="flex items-center px-4 py-2 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-md shadow-accent/20 min-h-[44px]"
                  >
                    <Plus className="w-5 h-5 mr-2" />
                    Add Session
                  </button>
                )}
              </div>

              {isSessionFormOpen ? (
                <SessionForm 
                  onSubmit={handleSessionSubmit} 
                  onCancel={() => setIsSessionFormOpen(false)} 
                />
              ) : (
                <ChargingHistory />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 2: Run linter and tests**

Run: `npm run lint && npm run test -- --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(nav): integrate responsive navigation into App layout"
```
