import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it, beforeEach } from 'vitest'
import { createDatabase } from '@/lib/db'

describe('Dexie migrations', () => {
  const dbName = 'migration-test'

  beforeEach(async () => {
    await Dexie.delete(dbName).catch(() => undefined)
  })

  it('migrates legacy pending ops to the new schema', async () => {
    const legacy = new Dexie(dbName)
    legacy.version(1).stores({
      jobs: '&id,date,crew,updatedAt',
      times: '&id,jobId,start,updatedAt,[jobId+start]',
      policy: '&key',
      state: '&key',
      kudos: '&id,updatedAt',
      users: '&id,updatedAt',
      media: '&id,jobId,updatedAt',
      pendingOps: '&queueId,table,ts',
    })
    await legacy.open()
    await legacy.table('pendingOps').put({
      queueId: 'abc',
      kind: 'put',
      table: 'jobs',
      key: 123,
      payload: { id: 123, client: 'Legacy' },
      ts: 1700000000000,
    })
    await legacy.close()

    const upgraded = createDatabase(dbName)
    await upgraded.open()

    const pending = await upgraded.pendingOps.toArray()
    expect(pending).toHaveLength(1)
    const op = pending[0]
    expect(op.id).toBe('abc')
    expect((op as Record<string, unknown>).queueId).toBe('abc')
    expect(op.type).toBe('put')
    expect(op.payload).toBeTruthy()
    expect(op.attempt).toBe(0)
    expect(op.nextAt).toBeGreaterThan(0)
    expect(op.createdAt).toBeGreaterThan(0)
    expect(op.updatedAt).toBeGreaterThan(0)

    await upgraded.close()
  })
})
