import { expect, test } from 'vitest'

/**
 * Smoke tests for the shared test runtime.
 *
 * Confirms Vitest assertions and fake IndexedDB setup are available before the
 * feature-level suites rely on them.
 */
test('vitest is working', () => {
  // Arrange: Define a minimal arithmetic expression.
  const sum = 1 + 1

  // Assert: Vitest should evaluate the expected result.
  expect(sum).toBe(2)
})

test('fake-indexeddb is working', async () => {
  // Act: Open an IndexedDB database using the fake-indexeddb test setup.
  const request = indexedDB.open('test-db', 1)

  // Assert: The IndexedDB API should return an open request.
  expect(request).toBeDefined()
})
