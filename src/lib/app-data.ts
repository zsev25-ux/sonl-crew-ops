import {
  db,
  bulkUpsert,
  deleteByKey,
  getByKey,
  putRecord,
  type AppStateRecord,
  type JobRecord,
  type PolicyRecord,
} from '@/lib/db'
import type { Job, Policy, User } from '@/lib/types'
import { load } from '@/lib/storage'

const LEGACY_STORAGE_KEYS = {
  jobs: 'sonl.jobs.v1',
  policy: 'sonl.policy.v1',
  activeDate: 'sonl.activeDate.v1',
  user: 'sonl.user.v1',
} as const

const STATE_KEYS = {
  activeDate: 'activeDate',
  currentUser: 'currentUser',
} as const

export type AppDataSnapshot = {
  jobs: Job[]
  policy: Policy
  activeDate: string
  user: User | null
}

export type BootstrapSource = 'dexie' | 'legacy-localStorage' | 'fallback'

export type BootstrapResult = {
  snapshot: AppDataSnapshot
  source: BootstrapSource
  dexieAvailable: boolean
}

const toJobRecord = (job: Job, updatedAt?: number): JobRecord => ({
  id: job.id,
  date: job.date,
  crew: job.crew,
  client: job.client,
  scope: job.scope,
  notes: job.notes,
  address: job.address,
  neighborhood: job.neighborhood,
  zip: job.zip,
  houseTier: job.houseTier,
  rehangPrice: job.rehangPrice,
  lifetimeSpend: job.lifetimeSpend,
  vip: job.vip,
  bothCrews: job.crew === 'Both Crews',
  updatedAt: updatedAt ?? Date.now(),
})

const fromJobRecord = (record: JobRecord): Job => ({
  id: record.id,
  date: record.date,
  crew: record.crew,
  client: record.client,
  scope: record.scope,
  notes: record.notes,
  address: record.address,
  neighborhood: record.neighborhood,
  zip: record.zip,
  houseTier: record.houseTier,
  rehangPrice: record.rehangPrice,
  lifetimeSpend: record.lifetimeSpend,
  vip: record.vip,
  meta: undefined,
})

const readLegacySnapshot = (fallback: AppDataSnapshot): AppDataSnapshot => {
  const jobs = load<Job[]>(LEGACY_STORAGE_KEYS.jobs, fallback.jobs)
  const policy = load<Policy>(LEGACY_STORAGE_KEYS.policy, fallback.policy)
  const activeDate = load<string>(LEGACY_STORAGE_KEYS.activeDate, fallback.activeDate)
  const user = load<User | null>(LEGACY_STORAGE_KEYS.user, fallback.user)

  return {
    jobs,
    policy,
    activeDate: activeDate || fallback.activeDate,
    user,
  }
}

export async function bootstrapAppData(
  fallback: AppDataSnapshot,
): Promise<BootstrapResult> {
  try {
    await db.open()
  } catch (error) {
    console.warn('[app-data] IndexedDB unavailable, using in-memory fallback.', error)
    return {
      snapshot: fallback,
      source: 'fallback',
      dexieAvailable: false,
    }
  }

  try {
    const jobCount = await db.jobs.count()

    if (jobCount === 0) {
      const legacySnapshot = readLegacySnapshot(fallback)
      const records = legacySnapshot.jobs.map((job) => toJobRecord(job))
      if (records.length > 0) {
        await bulkUpsert('jobs', records)
      }
      await putRecord('policy', {
        key: 'org',
        value: legacySnapshot.policy,
        updatedAt: Date.now(),
      })
      await putRecord('state', {
        key: STATE_KEYS.activeDate,
        value: legacySnapshot.activeDate,
        updatedAt: Date.now(),
      })
      if (legacySnapshot.user) {
        await putRecord('state', {
          key: STATE_KEYS.currentUser,
          value: legacySnapshot.user,
          updatedAt: Date.now(),
        })
      }

      return {
        snapshot: legacySnapshot,
        source: 'legacy-localStorage',
        dexieAvailable: true,
      }
    }

    const storedJobs = await db.jobs.orderBy('date').toArray()
    const policyRecord = await getByKey<PolicyRecord>('policy', 'org')
    const activeDateState = await getByKey<AppStateRecord>('state', STATE_KEYS.activeDate)
    const userState = await getByKey<AppStateRecord>('state', STATE_KEYS.currentUser)

    const policyValue = (policyRecord?.value as Policy | undefined) ?? fallback.policy
    const activeDateValue = (activeDateState?.value as string | undefined) ?? fallback.activeDate
    const userValue = (userState?.value as User | undefined) ?? fallback.user

    const snapshot: AppDataSnapshot = {
      jobs: storedJobs.map((record) => fromJobRecord(record)),
      policy: policyValue,
      activeDate: activeDateValue,
      user: userValue,
    }

    return {
      snapshot,
      source: 'dexie',
      dexieAvailable: true,
    }
  } catch (error) {
    console.error('[app-data] Failed to bootstrap IndexedDB, reverting to fallback.', error)
    return {
      snapshot: fallback,
      source: 'fallback',
      dexieAvailable: true,
    }
  }
}

export async function persistJobs(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) {
    await db.jobs.clear()
    return
  }
  const records = jobs.map((job) => toJobRecord(job))
  await bulkUpsert('jobs', records)
}

export async function persistPolicy(policy: Policy): Promise<void> {
  await putRecord('policy', {
    key: 'org',
    value: policy,
    updatedAt: Date.now(),
  })
}

export async function persistActiveDate(date: string): Promise<void> {
  await putRecord('state', {
    key: STATE_KEYS.activeDate,
    value: date,
    updatedAt: Date.now(),
  })
}

export async function persistUser(user: User | null): Promise<void> {
  if (user) {
    await putRecord('state', {
      key: STATE_KEYS.currentUser,
      value: user,
      updatedAt: Date.now(),
    })
  } else {
    await deleteByKey('state', STATE_KEYS.currentUser)
  }
}
