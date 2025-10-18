import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestoreMocks = vi.hoisted(() => ({
  setDoc: vi.fn(async () => undefined),
}))

vi.mock('@/lib/firebase', () => ({
  cloudEnabled: true,
  db: {},
  ensureAnonAuth: vi.fn().mockResolvedValue(undefined),
  storage: undefined,
}))

vi.mock('firebase/firestore', () => ({
  collection: (...segments: unknown[]) => segments.join('/'),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  doc: (...segments: unknown[]) => segments.join('/'),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  increment: vi.fn((value: number) => value),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  setDoc: firestoreMocks.setDoc,
  type: {} as never,
}))

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytesResumable: vi.fn(),
  getDownloadURL: vi.fn(),
}))

import { enqueueSyncOp, processPendingQueue } from '@/lib/sync'
import { db, resetDatabase } from '@/lib/db'

describe('sync queue sanitization', () => {
  beforeEach(async () => {
    await resetDatabase()
    firestoreMocks.setDoc.mockClear()
  })

  it('sanitizes invalid fields before writing jobs to Firestore', async () => {
    await enqueueSyncOp({
      type: 'job.add',
      job: {
        id: 101,
        date: '2025-12-01',
        crew: 'Crew Alpha',
        client: ' Example Client ',
        scope: 'Install',
        notes: undefined,
        address: ' 123 Main St ',
        neighborhood: '  ',
        zip: undefined,
        houseTier: '7' as unknown as number,
        rehangPrice: Number.NaN,
        lifetimeSpend: Number.POSITIVE_INFINITY,
        vip: false,
      },
    })

    expect(await db.pendingOps.count()).toBe(1)

    await processPendingQueue(true)

    expect(firestoreMocks.setDoc).toHaveBeenCalled()
    const payload = firestoreMocks.setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload).toBeDefined()
    expect(payload.zip).toBe('')
    expect(payload.neighborhood).toBe('')
    expect(payload.rehangPrice).toBeNull()
    expect(payload.lifetimeSpend).toBeNull()
    expect(payload.houseTier).toBe(5)
    expect(payload.crew).toBe('Crew Alpha')
    expect(payload.client).toBe('Example Client')
  })
})
