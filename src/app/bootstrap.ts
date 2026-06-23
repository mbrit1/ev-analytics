/**
 * Browser bootstrap helpers for local development startup.
 */
const DEV_SW_RESET_KEY = 'ev-analytics-dev-sw-reset'

type MockModeEnv = {
  DEV: boolean
  VITE_ENABLE_MOCKS?: string
}

/**
 * Returns true only for explicit Vite development mock-mode sessions.
 */
export const isExplicitMockMode = (env: MockModeEnv): boolean => {
  return env.DEV && env.VITE_ENABLE_MOCKS === 'true'
}

/**
 * Clears previously registered service workers before dev startup so a stale
 * preview/PWA bundle cannot continue controlling the app origin.
 */
export async function clearDevelopmentServiceWorkers(
  serviceWorker: Pick<ServiceWorkerContainer, 'getRegistrations'> | undefined,
  isDev: boolean,
): Promise<boolean> {
  if (!isDev || serviceWorker == null) {
    return false
  }

  const registrations = await serviceWorker.getRegistrations()
  const hadController = globalThis.navigator?.serviceWorker?.controller != null
  await Promise.all(registrations.map((registration) => registration.unregister()))

  if (!hadController || registrations.length === 0) {
    sessionStorage.removeItem(DEV_SW_RESET_KEY)
    return false
  }

  if (sessionStorage.getItem(DEV_SW_RESET_KEY) === 'done') {
    sessionStorage.removeItem(DEV_SW_RESET_KEY)
    return false
  }

  sessionStorage.setItem(DEV_SW_RESET_KEY, 'done')
  return true
}
