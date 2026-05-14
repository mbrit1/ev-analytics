import { expect, test } from 'vitest'

test('vitest is working', () => {
  expect(1 + 1).toBe(2)
})

test('fake-indexeddb is working', async () => {
  const request = indexedDB.open('test-db', 1)
  expect(request).toBeDefined()
})
