import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { clearDevelopmentServiceWorkers, isExplicitMockMode } from './app/bootstrap'
import { AuthProvider } from './features/auth'

const ENABLE_MOCKS = isExplicitMockMode(import.meta.env)

/**
 * Starts the MSW browser worker only for explicit local mock-mode runs.
 *
 * Production and normal development builds bypass this so real Supabase
 * configuration is used unless `VITE_ENABLE_MOCKS` opts into seeded mock data.
 */
async function prepareBrowserRuntime() {
  const needsReload = await clearDevelopmentServiceWorkers(
    globalThis.navigator?.serviceWorker,
    import.meta.env.DEV,
  )
  if (needsReload) {
    globalThis.location.reload()
    return
  }

  if (!ENABLE_MOCKS) {
    return
  }

  const { worker } = await import('./mocks/browser')
  return worker.start({
    onUnhandledRequest: 'bypass',
  })
}

prepareBrowserRuntime().then(() => {
  // Rendering waits for mock setup so first-load auth/data requests are either
  // all intercepted in mock mode or all sent to the configured backend.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  )
})
