import Dexie, { type Table } from 'dexie'
import { normalizeMaterials, type JobMaterials } from '@/lib/jobmeta'
import { normalizeJob, parseJob } from '@/lib/job-schema'
import { safeSerialize, type SanitizeReport } from '@/lib/sanitize'

export type JobRecord = {
  id: number
  date: string
  crew: string
  client: string
  scope: string
  notes?: string
  address?: string
  neighborhood?: string
  zip?: string
  houseTier?: number
  rehangPrice?: number
  lifetimeSpend?: number
  vip?: boolean
  bothCrews?: boolean
  materials?: JobMaterials
  updatedAt: number
}

export type TimeRecord = {
  id: string
  jobId: number
  start: number
  end?: number | null
  manualHours?: number | null
  updatedAt: number
}

export type PolicyRecord = {
  key: 'org'
  value: unknown
  updatedAt: number
}

export type AppStateRecord = {
  key: string
  value: unknown
  updatedAt: number
}

export type KudosRecord = {
  id: string
  imageUrl?: string
  message: string
  crewName: string
  timestamp: number
  reactions?: Record<string, number>
  updatedAt: number
}

export type UserRecord = {
  id: string
  displayName: string
  profileImageUrl?: string
  stats?: Record<string, unknown>
  achievements?: Record<string, unknown>
  updatedAt: number
}

export type MediaRecord = {
  id: string
  jobId: number
  kind: 'image' | 'video'
  mime?: string
  localBlob?: Blob
  localUrl?: string
  remoteUrl?: string
  thumbUrl?: string
  width?: number
  height?: number
  createdAt: number
  updatedAt: number
}

export type PendingOpType =
  | 'job.add'
  | 'job.update'
  | 'job.delete'
  | 'policy.update'
  | 'kudos.react'
  | 'media.upload'
  | 'custom'

export type PendingOpRecord = {
  id: string
  type: PendingOpType
  payload: unknown
  attempt: number
  nextAt: number
  createdAt: number
  updatedAt: number
  queueId?: string
}

export type TableKey =
  | 'jobs'
  | 'times'
  | 'policy'
  | 'state'
  | 'kudos'
  | 'users'
  | 'media'
  | 'pendingOps'

type TableValue =
  | JobRecord
  | TimeRecord
  | PolicyRecord
  | AppStateRecord
  | KudosRecord
  | UserRecord
  | MediaRecord
  | PendingOpRecord

type UpdatableRecord = Exclude<TableValue, PendingOpRecord>

export class SonlCrewOpsDexie extends Dexie {
  jobs!: Table<JobRecord, number>
  times!: Table<TimeRecord, string>
  policy!: Table<PolicyRecord, string>
  state!: Table<AppStateRecord, string>
  kudos!: Table<KudosRecord, string>
  users!: Table<UserRecord, string>
  media!: Table<MediaRecord, string>
  pendingOps!: Table<PendingOpRecord, string>
}

const configureDatabase = (database: SonlCrewOpsDexie): SonlCrewOpsDexie => {
  database.version(1).stores({
    jobs: '&id,date,crew,updatedAt',
    times: '&id,jobId,start,updatedAt,[jobId+start]',
    policy: '&key',
    state: '&key',
    kudos: '&id,updatedAt',
    users: '&id,updatedAt',
    media: '&id,jobId,updatedAt',
    pendingOps: '&queueId,table,ts',
  })

  database.version(2)
    .stores({
      jobs: '&id,date,crew,updatedAt',
      times: '&id,jobId,start,updatedAt,[jobId+start]',
      policy: '&key',
      state: '&key',
      kudos: '&id,updatedAt',
      users: '&id,updatedAt',
      media: '&id,jobId,updatedAt',
      pendingOps: '&queueId,type,nextAt,createdAt,updatedAt,id',
    })
    .upgrade(async (transaction) => {
    const pendingTable = transaction.table('pendingOps')
    const legacyRecords = await pendingTable.toArray()
    await pendingTable.clear()
    for (const legacy of legacyRecords) {
      const queueId =
        (legacy.queueId as string | undefined) ??
        (legacy.id as string | undefined) ??
        `${legacy.table ?? 'op'}-${
          typeof legacy.ts === 'number' ? legacy.ts : Date.now()
        }`
      const createdAt =
        typeof legacy.ts === 'number'
          ? legacy.ts
          : typeof legacy.createdAt === 'number'
            ? (legacy.createdAt as number)
            : Date.now()
      const transformed: Record<string, unknown> = {
        queueId,
        id: queueId,
        type: (legacy.kind as PendingOpType | undefined) ?? 'custom',
        payload:
          legacy.payload ??
          ({
            table: legacy.table,
            key: legacy.key,
            payload: legacy.payload,
          } as PendingOpRecord['payload']),
        attempt: typeof legacy.attempt === 'number' ? legacy.attempt : 0,
        nextAt:
          typeof legacy.nextAt === 'number'
            ? (legacy.nextAt as number)
            : typeof legacy.ts === 'number'
              ? (legacy.ts as number)
              : Date.now(),
        createdAt,
        updatedAt:
          typeof legacy.updatedAt === 'number' ? (legacy.updatedAt as number) : createdAt,
      }
        await pendingTable.put(transformed)
    }
  })

  database.version(3)
    .stores({
      jobs: '&id,date,crew,updatedAt',
      times: '&id,jobId,start,updatedAt,[jobId+start]',
      policy: '&key',
      state: '&key',
      kudos: '&id,updatedAt',
      users: '&id,updatedAt',
      media: '&id,jobId,updatedAt',
      pendingOps: '&queueId,type,nextAt,createdAt,updatedAt,id',
    })
    .upgrade(async (transaction) => {
      const jobsTable = transaction.table('jobs')
      await jobsTable.toCollection().modify((record) => {
        if (record && typeof record === 'object' && 'materials' in record) {
          (record as Record<string, unknown>).materials = normalizeMaterials(
            (record as Record<string, unknown>).materials,
          )
        }
        if (
          record &&
          typeof record === 'object' &&
          'meta' in record &&
          record.meta &&
          typeof record.meta === 'object' &&
          'materials' in record.meta
        ) {
          (record.meta as Record<string, unknown>).materials = normalizeMaterials(
            (record.meta as Record<string, unknown>).materials,
          )
        }
      })

      const stateTable = transaction.table('state')
      await stateTable.toCollection().modify((record) => {
        if (
          record &&
          typeof record === 'object' &&
          record.value &&
          typeof record.value === 'object' &&
          'materials' in record.value
        ) {
          (record.value as Record<string, unknown>).materials = normalizeMaterials(
            (record.value as Record<string, unknown>).materials,
          )
        }
      })

      const pendingTable = transaction.table('pendingOps')
      await pendingTable.toCollection().modify((record) => {
        if (
          record &&
          typeof record === 'object' &&
          record.payload &&
          typeof record.payload === 'object' &&
          'job' in record.payload &&
          record.payload.job &&
          typeof record.payload.job === 'object' &&
          'meta' in record.payload.job &&
          record.payload.job.meta &&
          typeof record.payload.job.meta === 'object' &&
          'materials' in record.payload.job.meta
        ) {
          (record.payload.job.meta as Record<string, unknown>).materials = normalizeMaterials(
            (record.payload.job.meta as Record<string, unknown>).materials,
          )
        }
      })
    })

  return database
}

export const createDatabase = (name = 'sonlCrewOps'): SonlCrewOpsDexie =>
  configureDatabase(new SonlCrewOpsDexie(name))

export const db = createDatabase()

const readTable = <T extends TableValue>(
  table: TableKey,
): Table<T, string | number> => {
  switch (table) {
    case 'jobs':
      return db.jobs as Table<T, number>
    case 'times':
      return db.times as Table<T, string>
    case 'policy':
      return db.policy as Table<T, string>
    case 'state':
      return db.state as Table<T, string>
    case 'kudos':
      return db.kudos as Table<T, string>
    case 'users':
      return db.users as Table<T, string>
    case 'media':
      return db.media as Table<T, string>
    case 'pendingOps':
      return db.pendingOps as Table<T, string>
    default:
      throw new Error(`Unsupported table "${table as string}"`)
  }
}

export async function getAll<T extends TableValue>(table: TableKey): Promise<T[]> {
  return (await readTable<T>(table).toArray()) as T[]
}

export async function getByKey<T extends TableValue>(
  table: TableKey,
  key: string | number,
): Promise<T | undefined> {
  return (await readTable<T>(table).get(key)) as T | undefined
}

export async function putRecord<T extends UpdatableRecord>(
  table: TableKey,
  value: T,
): Promise<void> {
  const payload =
    'updatedAt' in value
      ? value
      : ({ ...(value as Record<string, unknown>), updatedAt: Date.now() } as T & {
          updatedAt: number
        })
  await readTable<T>(table).put(payload)
}

export async function bulkUpsert<T extends UpdatableRecord>(
  table: TableKey,
  values: T[],
): Promise<void> {
  if (values.length === 0) {
    return
  }
  const stamped = values.map((value) =>
    'updatedAt' in value && typeof value.updatedAt === 'number'
      ? value
      : ({ ...(value as Record<string, unknown>), updatedAt: Date.now() } as T & {
          updatedAt: number
        }),
  )
  await readTable<T>(table).bulkPut(stamped)
}

export async function deleteByKey(
  table: TableKey,
  key: string | number,
): Promise<void> {
  await readTable(table).delete(key)
}

export async function getPendingOpsCount(): Promise<number> {
  return db.pendingOps.count()
}

export async function clearTable(table: TableKey): Promise<void> {
  await readTable(table).clear()
}

export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

export async function addPendingOp(record: PendingOpRecord): Promise<void> {
  await db.pendingOps.put({
    ...(record as PendingOpRecord & { queueId?: string }),
    queueId: record.id,
  })
}

export async function getPendingOpsDue(threshold: number): Promise<PendingOpRecord[]> {
  return db.pendingOps.where('nextAt').belowOrEqual(threshold).toArray()
}

export async function updatePendingOp(
  id: string,
  changes: Partial<PendingOpRecord>,
): Promise<void> {
  await db.pendingOps.update(id, { ...changes, updatedAt: Date.now() })
}

export async function cleanupData(): Promise<{ jobs: number; pendingOps: number }> {
  let jobsFixed = 0
  let pendingFixed = 0

  await db.transaction('rw', db.jobs, db.pendingOps, async () => {
    const jobRecords = await db.jobs.toArray()
    const jobFields: (keyof JobRecord)[] = [
      'id',
      'date',
      'crew',
      'client',
      'scope',
      'notes',
      'address',
      'neighborhood',
      'zip',
      'houseTier',
      'rehangPrice',
      'lifetimeSpend',
      'vip',
      'bothCrews',
      'updatedAt',
    ]

    for (const record of jobRecords) {
      const normalized = normalizeJob({
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
        bothCrews: record.bothCrews,
        updatedAt: record.updatedAt,
      })

      const cleaned: JobRecord = {
        id: normalized.id,
        date: normalized.date,
        crew: normalized.crew,
        client: normalized.client,
        scope: normalized.scope,
        notes: normalized.notes,
        address: normalized.address,
        neighborhood: normalized.neighborhood,
        zip: normalized.zip,
        houseTier: normalized.houseTier,
        rehangPrice: normalized.rehangPrice,
        lifetimeSpend: normalized.lifetimeSpend,
        vip: normalized.vip,
        bothCrews: normalized.bothCrews,
        updatedAt: normalized.updatedAt ?? record.updatedAt,
      }

      const changed = jobFields.some((field) => record[field] !== cleaned[field])
      if (changed) {
        await db.jobs.put(cleaned)
        jobsFixed += 1
      }
    }

    const opRecords = await db.pendingOps.toArray()
    for (const record of opRecords) {
      const payload = record.payload
      if (!payload || typeof payload !== 'object') {
        continue
      }
      if ('job' in (payload as Record<string, unknown>)) {
        const rawJob = (payload as { job?: unknown }).job
        if (!rawJob || typeof rawJob !== 'object') {
          continue
        }
        try {
          const { job: normalized } = parseJob(rawJob)
          const report: SanitizeReport = { removed: [], changes: [] }
          const sanitized = safeSerialize(normalized, { report })
          const originalJson = JSON.stringify(rawJob)
          const sanitizedJson = JSON.stringify(sanitized)
          if (originalJson !== sanitizedJson) {
            await db.pendingOps.update(record.id, {
              payload: { ...(payload as Record<string, unknown>), job: sanitized },
            })
            pendingFixed += 1
          }
        } catch (error) {
          console.warn('[cleanup] unable to normalize pending op', record.id, error)
        }
      }
    }
  })

  if (jobsFixed > 0 || pendingFixed > 0) {
    console.info('[cleanup] sanitized records', { jobsFixed, pendingFixed })
  }

  return { jobs: jobsFixed, pendingOps: pendingFixed }
}
