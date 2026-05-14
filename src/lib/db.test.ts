import { describe, it, expect } from 'vitest'
import { EVAnalyticsDB } from './db'

describe('EVAnalyticsDB', () => {
  it('should instantiate the database', () => {
    const db = new EVAnalyticsDB()
    expect(db).toBeDefined()
  })

  it('should have the required tables', () => {
    const db = new EVAnalyticsDB()
    expect(db.providers).toBeDefined()
    expect(db.tariffs).toBeDefined()
    expect(db.sessions).toBeDefined()
    expect(db.sync_outbox).toBeDefined()
  })
})
