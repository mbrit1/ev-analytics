import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { AuthProvider } from './features/auth'

const ENABLE_MOCKS =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === 'true'

/**
 * Starts the MSW browser worker only for explicit local mock-mode runs.
 *
 * Production and normal development builds bypass this so real Supabase
 * configuration is used unless `VITE_ENABLE_MOCKS` opts into seeded mock data.
 */
async function enableMocking() {
  if (!ENABLE_MOCKS) {
    return
  }

  const { worker } = await import('./mocks/browser')
  return worker.start({
    onUnhandledRequest: 'bypass',
  })
}

enableMocking().then(() => {
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
