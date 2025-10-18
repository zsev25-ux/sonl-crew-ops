import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanupData, db, resetDatabase } from '@/lib/db'
import type { JobMaterials } from '@/lib/jobmeta'

const createMaterials = (): JobMaterials => ({
  zWireFt: 150.5,
  malePlugs: 12,
  femalePlugs: 8,
  timers: 3,
})

describe('cleanupData', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('preserves materials when normalizing existing jobs', async () => {
    const materials = createMaterials()
    await db.jobs.put({
      id: 1,
      date: ' 2024-12-01 ',
      crew: ' Crew Alpha ',
      client: 'Client 1',
      scope: ' Install lights ',
      notes: '  needs extra timers  ',
      address: ' 123 Holiday Ln ',
      neighborhood: '  ',
      zip: ' 84047 ',
      houseTier: 3,
      rehangPrice: 200,
      lifetimeSpend: 1000,
      vip: true,
      bothCrews: false,
      materials,
      updatedAt: Date.now() - 10_000,
    })

    const result = await cleanupData()
    expect(result.jobs).toBe(1)

    const stored = await db.jobs.get(1)
    expect(stored).toBeTruthy()
    expect(stored?.materials).toEqual(materials)
    expect(stored?.crew).toBe('Crew Alpha')
    expect(stored?.notes).toBe('needs extra timers')
  })
})
