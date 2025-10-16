import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it, beforeEach } from 'vitest'
import { createDatabase } from '@/lib/db'
import { sanitizeForFirestore, wasSanitized } from '@/lib/sanitize'

describe('Dexie migrations', () => {
  const dbName = 'migration-test'

  beforeEach(async () => {
    await Dexie.delete(dbName).catch(() => undefined)
  })

  it('sanitizes Firestore payloads by removing undefined values', () => {
    const original = {
      notes: undefined,
      address: undefined,
      nested: {
        neighborhood: undefined,
        zip: undefined,
        keep: 'value',
      },
      array: [1, undefined, { notes: undefined, ok: true }],
      createdAt: new Date('2024-01-01T00:00:00Z'),
    }

    const sanitized = sanitizeForFirestore(original)

    expect(sanitized).toEqual({
      array: [1, null, { notes: null, ok: true }],
      createdAt: new Date('2024-01-01T00:00:00Z'),
      nested: {
        keep: 'value',
        neighborhood: null,
        zip: null,
      },
      notes: null,
      address: null,
    })
    expect(original.nested?.neighborhood).toBeUndefined()
    expect(wasSanitized(sanitized)).toBe(true)
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

  it('migrates legacy jobs to normalize nullable text fields', async () => {
    const legacy = new Dexie(dbName)
    legacy.version(3).stores({
      jobs: '&id,date,crew,updatedAt',
      times: '&id,jobId,start,updatedAt,[jobId+start]',
      policy: '&key',
      state: '&key',
      kudos: '&id,updatedAt',
      users: '&id,updatedAt',
      media: '&id,jobId,updatedAt',
      pendingOps: '&queueId,type,nextAt,createdAt,updatedAt,id',
    })
    await legacy.open()
    await legacy.table('jobs').put({
      id: 42,
      date: '2025-01-15',
      crew: 'Crew Alpha',
      client: 'Legacy Client',
      scope: 'Install',
      updatedAt: Date.now(),
    })
    await legacy.close()

    const upgraded = createDatabase(dbName)
    await upgraded.open()
    const job = await upgraded.jobs.get(42)
    expect(job?.notes ?? null).toBeNull()
    expect(job?.address ?? null).toBeNull()
    expect(job?.neighborhood ?? null).toBeNull()
    expect(job?.zip ?? null).toBeNull()
    expect(job?.client).toBe('Legacy Client')
    await upgraded.close()
  })
})
