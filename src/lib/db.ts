import Dexie, { type Table } from 'dexie'
import { normalizeMaterials, type JobMaterials } from '@/lib/jobmeta'
import { safePrepareJobForFirestore } from '@/lib/job-schema'
import { safeSerialize } from '@/lib/sanitize'

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
  role: 'crew' | 'admin' | 'owner'
  bio?: string
  photoURL?: string
  stats?: Record<string, unknown>
  season?: Record<string, unknown>
  createdAt?: number
  updatedAt: number
}

export type AwardRecord = {
  id: string
  userRefId: string
  seasonId: string
  key: string
  title: string
  icon?: string
  earnedAt: number
  updatedAt: number
}

export type MediaStatus = 'local' | 'queued' | 'uploading' | 'synced' | 'error'

export type MediaRecord = {
  id: string
  jobId?: string
  name: string
  type: string
  size: number
  blob: Blob | null
  localUrl?: string | null
  remoteUrl?: string | null
  remotePath?: string | null
  status: MediaStatus
  error?: string | null
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
  | 'user.update'
  | 'user.avatar.upload'
  | 'award.grant'
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
  | 'awards'
  | 'media'
  | 'pendingOps'

type TableValue =
  | JobRecord
  | TimeRecord
  | PolicyRecord
  | AppStateRecord
  | KudosRecord
  | UserRecord
  | AwardRecord
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
  awards!: Table<AwardRecord, string>
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
    awards: '&id,userRefId,seasonId,updatedAt',
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
      awards: '&id,userRefId,seasonId,updatedAt',
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
      awards: '&id,userRefId,seasonId,updatedAt',
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

  database.version(4)
    .stores({
      jobs: '&id,date,crew,updatedAt',
      times: '&id,jobId,start,updatedAt,[jobId+start]',
      policy: '&key',
      state: '&key',
      kudos: '&id,updatedAt',
      users: '&id,updatedAt',
      media: '&id,jobId,name,type,size,status,createdAt',
      pendingOps: '&queueId,type,nextAt,createdAt,updatedAt,id',
    })
    .upgrade(async (transaction) => {
      const mediaTable = transaction.table('media')
      const legacyRecords = await mediaTable.toArray()
      if (legacyRecords.length === 0) {
        return
      }

      const now = Date.now()
      await mediaTable.clear()
      for (const legacy of legacyRecords) {
        const blob =
          legacy && 'blob' in legacy && legacy.blob instanceof Blob
            ? (legacy.blob as Blob)
            : legacy && 'localBlob' in legacy && legacy.localBlob instanceof Blob
              ? (legacy.localBlob as Blob)
              : null
        const createdAt =
          typeof legacy?.createdAt === 'number' ? (legacy.createdAt as number) : now
        const id =
          typeof legacy?.id === 'string' && legacy.id
            ? (legacy.id as string)
            : generateMediaId()
        const record: MediaRecord = {
          id,
          jobId:
            typeof legacy?.jobId === 'number'
              ? String(legacy.jobId)
              : typeof legacy?.jobId === 'string'
                ? (legacy.jobId as string)
                : undefined,
          name:
            typeof legacy?.name === 'string' && legacy.name
              ? (legacy.name as string)
              : id,
          type:
            typeof legacy?.type === 'string' && legacy.type
              ? (legacy.type as string)
              : typeof legacy?.mime === 'string' && legacy.mime
                ? (legacy.mime as string)
                : blob
                  ? blob.type || 'application/octet-stream'
                  : 'application/octet-stream',
          size:
            typeof legacy?.size === 'number'
              ? (legacy.size as number)
              : blob
                ? blob.size
                : 0,
          blob,
          localUrl:
            typeof legacy?.localUrl === 'string' ? (legacy.localUrl as string) : null,
          remoteUrl:
            typeof legacy?.remoteUrl === 'string' ? (legacy.remoteUrl as string) : null,
          remotePath: null,
          status:
            typeof legacy?.remoteUrl === 'string' && legacy.remoteUrl
              ? 'synced'
              : 'local',
          error: null,
          createdAt,
          updatedAt: now,
        }

        await mediaTable.put(record)
      }
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
    case 'awards':
      return db.awards as Table<T, string>
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

export type MediaRow = MediaRecord

export const generateMediaId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function addLocalMedia(file: File, jobId?: string): Promise<string> {
  const timestamp = Date.now()
  const record: MediaRecord = {
    id: generateMediaId(),
    jobId,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    localUrl: null,
    remoteUrl: null,
    remotePath: null,
    status: 'local',
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.media.add(record)
  return record.id
}

export async function setMediaStatus(
  id: string,
  status: MediaStatus,
  patch: Partial<MediaRecord> = {},
): Promise<void> {
  await db.media.update(id, {
    ...patch,
    status,
    updatedAt: Date.now(),
  })
}

export async function getUnsyncedMedia(): Promise<MediaRow[]> {
  return db.media
    .where('status')
    .notEqual('synced')
    .toArray()
}
