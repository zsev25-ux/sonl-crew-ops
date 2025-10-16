import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapAppData, persistActiveDate, persistJobs, persistPolicy, persistUser } from '@/lib/app-data'
import { db, resetDatabase } from '@/lib/db'
import type { Job, Policy, User } from '@/lib/types'

class MemoryStorage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

const createJob = (id: number, overrides: Partial<Job> = {}): Job => ({
  id,
  date: '2024-12-01',
  crew: 'Crew Alpha',
  client: `Client ${id}`,
  scope: 'Install lights',
  notes: undefined,
  address: undefined,
  neighborhood: undefined,
  zip: undefined,
  houseTier: 1,
  rehangPrice: 250,
  lifetimeSpend: 1200,
  vip: false,
  meta: undefined,
  ...overrides,
})

const basePolicy: Policy = {
  cutoffDateISO: '2024-12-10',
  blockedClients: [],
  maxJobsPerDay: 2,
}

const fallbackSnapshot = {
  jobs: [createJob(1)],
  policy: basePolicy,
  activeDate: '2024-12-01',
  user: null as User | null,
}

const setLegacyStorage = (payload: {
  jobs?: Job[]
  policy?: Policy
  activeDate?: string
  user?: User | null
}) => {
  const windowRef = globalThis.window as unknown as { localStorage: MemoryStorage }
  if (payload.jobs) {
    windowRef.localStorage.setItem('sonl.jobs.v1', JSON.stringify(payload.jobs))
  }
  if (payload.policy) {
    windowRef.localStorage.setItem('sonl.policy.v1', JSON.stringify(payload.policy))
  }
  if (payload.activeDate) {
    windowRef.localStorage.setItem('sonl.activeDate.v1', JSON.stringify(payload.activeDate))
  }
  if (payload.user) {
    windowRef.localStorage.setItem('sonl.user.v1', JSON.stringify(payload.user))
  }
}

beforeEach(async () => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() })
  await resetDatabase()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('app-data bootstrap', () => {
  it('migrates from legacy localStorage when the Dexie store is empty', async () => {
    const legacyJobs = [createJob(41), createJob(42, { crew: 'Both Crews' })]
    setLegacyStorage({
      jobs: legacyJobs,
      policy: { ...basePolicy, blockedClients: ['Legacy Crew'] },
      activeDate: '2024-12-05',
      user: { name: 'Admin', role: 'admin' },
    })

    const result = await bootstrapAppData(fallbackSnapshot)

    expect(result.source).toBe('legacy-localStorage')
    expect(result.snapshot.jobs).toHaveLength(legacyJobs.length)
    expect(result.snapshot.activeDate).toBe('2024-12-05')
    expect(result.snapshot.user?.name).toBe('Admin')

    const persistedJobs = await db.jobs.orderBy('date').toArray()
    expect(persistedJobs).toHaveLength(legacyJobs.length)
    expect(persistedJobs[0]?.client).toBe('Client 41')
  })

  it('reuses Dexie data after the first bootstrap', async () => {
    setLegacyStorage({
      jobs: [createJob(99)],
      policy: { ...basePolicy, cutoffDateISO: '2024-12-15' },
      activeDate: '2024-12-06',
    })

    await bootstrapAppData(fallbackSnapshot)
    const second = await bootstrapAppData(fallbackSnapshot)

    expect(second.source).toBe('dexie')
    expect(second.snapshot.jobs[0]?.id).toBe(99)
    expect(second.snapshot.policy.cutoffDateISO).toBe('2024-12-15')
  })
})

describe('app-data persistence helpers', () => {
  it('writes job, policy, date, and user changes into Dexie', async () => {
    await bootstrapAppData(fallbackSnapshot)

    const updatedJobs = [createJob(1, { scope: 'Updated scope' }), createJob(2)]
    await persistJobs(updatedJobs)
    await persistPolicy({ ...basePolicy, maxJobsPerDay: 3 })
    await persistActiveDate('2024-12-08')
    await persistUser({ name: 'Crew Alpha', role: 'crew' })

    const storedJobs = await db.jobs.orderBy('id').toArray()
    expect(storedJobs).toHaveLength(2)
    expect(storedJobs[0]?.scope).toBe('Updated scope')

    const storedPolicy = (await db.policy.get('org'))?.value as Policy
    expect(storedPolicy.maxJobsPerDay).toBe(3)

    const storedDate = (await db.state.get('activeDate'))?.value as string
    expect(storedDate).toBe('2024-12-08')

    const storedUser = (await db.state.get('currentUser'))?.value as User
    expect(storedUser.name).toBe('Crew Alpha')

    await persistUser(null)
    const clearedUser = await db.state.get('currentUser')
    expect(clearedUser).toBeUndefined()
  })
})
