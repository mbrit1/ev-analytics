/// <reference types="vitest/globals" />

import { clearDevelopmentServiceWorkers, isExplicitMockMode } from './bootstrap'

/**
 * Test suite for browser bootstrap helpers used by local development startup.
 *
 * Verifies mock mode stays opt-in for Vite development only and stale service
 * workers are cleared before dev startup can render an outdated cached bundle.
 */
describe('app bootstrap helpers', () => {
  it('enables mock mode only for explicit Vite development sessions', () => {
    // Arrange: Prepare dev and non-dev environment snapshots.
    const mockDevEnv = { DEV: true, VITE_ENABLE_MOCKS: 'true' }
    const productionEnv = { DEV: false, VITE_ENABLE_MOCKS: 'true' }
    const normalDevEnv = { DEV: true, VITE_ENABLE_MOCKS: 'false' }

    // Act: Resolve whether each environment should run in mock mode.
    const mockDevEnabled = isExplicitMockMode(mockDevEnv)
    const productionEnabled = isExplicitMockMode(productionEnv)
    const normalDevEnabled = isExplicitMockMode(normalDevEnv)

    // Assert: Only explicit development mock mode is enabled.
    expect(mockDevEnabled).toBe(true)
    expect(productionEnabled).toBe(false)
    expect(normalDevEnabled).toBe(false)
  })

  it('unregisters existing service workers before development startup', async () => {
    // Arrange: Simulate an origin already controlled by stale preview workers.
    const unregisterFirst = vi.fn().mockResolvedValue(true)
    const unregisterSecond = vi.fn().mockResolvedValue(true)
    const originalNavigator = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          controller: null,
        },
      },
    })
    const serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([
        { unregister: unregisterFirst },
        { unregister: unregisterSecond },
      ]),
    }

    try {
      // Act: Clear registrations for a development startup.
      const needsReload = await clearDevelopmentServiceWorkers(serviceWorker, true)

      // Assert: All existing registrations are removed.
      expect(needsReload).toBe(false)
      expect(serviceWorker.getRegistrations).toHaveBeenCalledTimes(1)
      expect(unregisterFirst).toHaveBeenCalledTimes(1)
      expect(unregisterSecond).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      })
    }
  })

  it('skips service worker cleanup outside development', async () => {
    // Arrange: Provide a service worker container for a non-dev startup.
    const serviceWorker = {
      getRegistrations: vi.fn(),
    }

    // Act: Attempt cleanup for a non-development startup.
    const needsReload = await clearDevelopmentServiceWorkers(serviceWorker, false)

    // Assert: Production startup leaves registrations untouched.
    expect(needsReload).toBe(false)
    expect(serviceWorker.getRegistrations).not.toHaveBeenCalled()
  })

  it('requests one reload when the current page is still controlled by a stale worker', async () => {
    // Arrange: Simulate a dev page still controlled by an old service worker.
    const originalNavigator = globalThis.navigator
    const originalSessionStorage = globalThis.sessionStorage
    const storage = new Map<string, string>()
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          controller: { state: 'activated' },
        },
      },
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key)
        }),
      },
    })
    const serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([{ unregister: vi.fn().mockResolvedValue(true) }]),
    }

    try {
      // Act: Clear the registrations twice across the same page lifecycle.
      const firstRunNeedsReload = await clearDevelopmentServiceWorkers(serviceWorker, true)
      const secondRunNeedsReload = await clearDevelopmentServiceWorkers(serviceWorker, true)

      // Assert: The first pass forces one reload and the next pass proceeds normally.
      expect(firstRunNeedsReload).toBe(true)
      expect(secondRunNeedsReload).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      })
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: originalSessionStorage,
      })
    }
  })
})
