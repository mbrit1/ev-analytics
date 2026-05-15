import { describe, it, expect, beforeEach } from 'vitest'
import { db, type Tariff } from '../../../lib/db'
import { saveTariff, getTariffs, deleteTariff } from './tariffService'
import 'fake-indexeddb/auto'

describe('tariffService', () => {
  beforeEach(async () => {
    await db.tariffs.clear()
    await db.sync_outbox.clear()
  })

  it('should save a tariff and create an outbox entry', async () => {
    const tariffData: Tariff = {
      id: 'tariff-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      tariff_name: 'Supercharger',
      ac_price_per_kwh: 45,
      dc_price_per_kwh: 45,
      session_fee: 0,
      valid_from: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }

    await saveTariff(tariffData)

    const tariff = await db.tariffs.get('tariff-1')
    expect(tariff).toBeDefined()
    expect(tariff?.tariff_name).toBe('Supercharger')

    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].table_name).toBe('tariffs')
  })

  it('should list all non-deleted tariffs', async () => {
    const t1: Tariff = {
      id: 't1', user_id: 'u1', provider_id: 'p1', tariff_name: 'T1',
      ac_price_per_kwh: 50, dc_price_per_kwh: 50, session_fee: 0,
      valid_from: new Date(), created_at: new Date(), updated_at: new Date()
    }
    const t2: Tariff = {
      id: 't2', user_id: 'u1', provider_id: 'p1', tariff_name: 'T2',
      ac_price_per_kwh: 60, dc_price_per_kwh: 60, session_fee: 0,
      valid_from: new Date(), created_at: new Date(), updated_at: new Date(),
      deleted_at: new Date()
    }

    await db.tariffs.bulkAdd([t1, t2])

    const tariffs = await getTariffs()
    expect(tariffs).toHaveLength(1)
    expect(tariffs[0].id).toBe('t1')
  })

  it('should soft delete a tariff and create a DELETE outbox entry', async () => {
    const tariff: Tariff = {
      id: 't-delete', user_id: 'u1', provider_id: 'p1', tariff_name: 'To Delete',
      ac_price_per_kwh: 50, dc_price_per_kwh: 50, session_fee: 0,
      valid_from: new Date(), created_at: new Date(), updated_at: new Date()
    }
    await db.tariffs.add(tariff)

    await deleteTariff('t-delete')

    const retrieved = await db.tariffs.get('t-delete')
    expect(retrieved?.deleted_at).toBeDefined()

    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].action).toBe('DELETE')
  })
})
