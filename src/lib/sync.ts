import { useSyncExternalStore } from 'react'
import type { Table as DexieTable } from 'dexie'
import {
  cloudEnabled,
  db as cloudDb,
  ensureAnonAuth,
  storage as cloudStorage,
} from '@/lib/firebase'
import {
  addPendingOp,
  db,
  deleteByKey,
  getPendingOpsCount,
  getPendingOpsDue,
  updatePendingOp,
  type PendingOpRecord,
  type PendingOpType,
} from '@/lib/db'
import type { Job, Policy } from '@/lib/types'
import { parseJob, JobValidationError } from '@/lib/job-schema'
import {
  safeSerialize,
  stripUndefined,
  type SanitizeReport,
  type SanitizeChange,
} from '@/lib/sanitize'
import { pushToast } from '@/lib/notifications'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage'

type SyncStatus = 'offline' | 'idle' | 'pushing' | 'pulling' | 'error'

const LAST_SYNC_KEY = 'sync:lastSuccess'

export type SyncState = {
  status: SyncStatus
  queued: number
  lastError: string | null
  lastSyncedAt: number | null
  lastSanitizedAt: number | null
}

export type PendingOpPayload =
  | { type: 'job.add'; job: Job }
  | { type: 'job.update'; job: Job }
  | { type: 'job.delete'; jobId: number }
  | { type: 'policy.update'; policy: Policy }
  | { type: 'kudos.react'; kudosId: string; emoji: string; by: string }
  | { type: 'media.upload'; mediaId: string; jobId: number }
  | { type: 'custom'; payload: Record<string, unknown> }

const BASE_RETRY_DELAY = 1_000
const MAX_RETRY_DELAY = 5 * 60_000

const initialStatus: SyncStatus =
  typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'idle'

let syncState: SyncState = {
  status: initialStatus,
  queued: 0,
  lastError: null,
  lastSyncedAt: null,
  lastSanitizedAt: null,
}

const listeners = new Set<(state: SyncState) => void>()
const sanitizeNotices = new Map<string, { removed: string[]; changed: string[] }>()

const publishSanitizeDiagnostics = (
  docPath: string,
  report: SanitizeReport,
  parseChanges: SanitizeChange[],
  warnings: string[],
  options: { skipCache?: boolean; notify?: boolean } = {},
): void => {
  report.removed = report.removed.filter((entry) => {
    const segments = entry.split('.').filter(Boolean)
    const last = segments[segments.length - 1]
    return last !== 'meta'
  })
  if (report.removed.length === 0 && parseChanges.length === 0 && warnings.length === 0) {
    return
  }

  const removedKeys = Array.from(
    new Set(
      report.removed
        .map((entry) => {
          const segments = entry.split('.').filter(Boolean)
          return segments[segments.length - 1] ?? entry
        })
        .filter((entry) => entry.length > 0),
    ),
  )

  const changedKeys = Array.from(
    new Set(parseChanges.map((change) => change.path).filter((path) => path.length > 0)),
  )

  const existing = options.skipCache ? undefined : sanitizeNotices.get(docPath)
  if (!existing) {
    console.warn('[sanitize]', docPath, {
      removed: removedKeys,
      changes: parseChanges,
      warnings,
    })
    if (!options.skipCache) {
      sanitizeNotices.set(docPath, { removed: removedKeys, changed: changedKeys })
    }
    if (warnings.length > 0) {
      console.warn('[sanitize][warnings]', docPath, warnings)
    }
  }

  const now = Date.now()
  const shouldNotifyRemoval = removedKeys.length > 0 && (!existing || options.skipCache)
  const shouldNotify = options.notify ?? true
  if (shouldNotifyRemoval && shouldNotify) {
    const fieldLabel =
      removedKeys.length === 1
        ? `invalid field “${removedKeys[0]}” (undefined)`
        : `invalid fields ${removedKeys.map((key) => `“${key}”`).join(', ')} (undefined)`
    const message = `Sync blocked: ${fieldLabel}. Fixed automatically and retried.`
    pushToast(message, 'warning')
    setSyncState({ lastError: message, lastSanitizedAt: now })
  } else {
    setSyncState({ lastSanitizedAt: now })
  }
}

const emit = () => {
  for (const listener of listeners) {
    listener(syncState)
  }
}

const setSyncState = (partial: Partial<SyncState>) => {
  syncState = { ...syncState, ...partial }
  emit()
}

const getSyncState = () => syncState

export function subscribeToSyncState(listener: (state: SyncState) => void): () => void {
  listeners.add(listener)
  listener(syncState)
  return () => {
    listeners.delete(listener)
  }
}

export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribeToSyncState, getSyncState)
}

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const getOnlineStatus = (): boolean => {
  if (typeof navigator === 'undefined') {
    return true
  }
  return navigator.onLine
}

const recordLastSync = async (timestamp: number) => {
  try {
    await db.state.put({ key: LAST_SYNC_KEY, value: timestamp, updatedAt: timestamp })
  } catch (error) {
    console.warn('Failed to persist last sync timestamp', error)
  }
  setSyncState({ lastSyncedAt: timestamp })
}

let lastSyncLoaded = false
const ensureLastSyncLoaded = async () => {
  if (lastSyncLoaded) {
    return
  }
  try {
    const record = await db.state.get(LAST_SYNC_KEY)
    if (record && typeof record.value === 'number') {
      syncState = { ...syncState, lastSyncedAt: record.value }
      emit()
    }
  } catch (error) {
    console.warn('Unable to load last sync timestamp', error)
  } finally {
    lastSyncLoaded = true
  }
}

const computeDelay = (attempt: number): number => {
  const base = Math.min(MAX_RETRY_DELAY, BASE_RETRY_DELAY * 2 ** attempt)
  const jitter = base * (0.5 + Math.random())
  return Math.round(Math.min(MAX_RETRY_DELAY, jitter))
}

export const updateConnectivity = (online: boolean): void => {
  setSyncState({
    status: online ? (syncState.status === 'error' ? 'error' : 'idle') : 'offline',
  })
  if (online) {
    void scheduleWorker()
  }
}

const refreshQueuedCount = async (): Promise<void> => {
  const queued = await getPendingOpsCount()
  setSyncState({ queued })
}

let workerTimer: ReturnType<typeof setTimeout> | null = null
let processing = false

const scheduleWorker = async (): Promise<void> => {
  if (workerTimer !== null || processing) {
    return
  }
  const next = await db.pendingOps.orderBy('nextAt').first()
  if (!next) {
    return
  }
  const delay = Math.max(0, next.nextAt - Date.now())
  workerTimer = setTimeout(() => {
    workerTimer = null
    void processPendingQueue()
  }, Math.min(delay, MAX_RETRY_DELAY))
}

const toMillis = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }
  if (value && typeof value === 'object' && 'toMillis' in (value as Timestamp)) {
    return (value as Timestamp).toMillis()
  }
  return Date.now()
}

const writeRemoteJobsToDexie = async (
  docs: QueryDocumentSnapshot<DocumentData>[],
): Promise<Job[]> => {
  const entries = docs.map((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>
    const jobId = Number(data.id ?? docSnap.id)
    const updatedAt = toMillis(data.updatedAt)
    const meta =
      data.meta && typeof data.meta === 'object'
        ? normalizeJobMeta(data.meta)
        : undefined
    const parsed: Job = {
      id: Number.isFinite(jobId) ? jobId : Date.now(),
      date: String(data.date ?? ''),
      crew: String(data.crew ?? 'Crew Alpha'),
      client: String(data.client ?? 'Client'),
      scope: String(data.scope ?? ''),
      notes: (data.notes as string) ?? undefined,
      address: (data.address as string) ?? undefined,
      neighborhood: (data.neighborhood as string) ?? undefined,
      zip: (data.zip as string) ?? undefined,
      houseTier: typeof data.houseTier === 'number' ? data.houseTier : undefined,
      rehangPrice: typeof data.rehangPrice === 'number' ? data.rehangPrice : undefined,
      lifetimeSpend: typeof data.lifetimeSpend === 'number' ? data.lifetimeSpend : undefined,
      vip: Boolean(data.vip),
      meta,
    }
    return { job: parsed, updatedAt }
  })

  await db.transaction('rw', db.jobs, async () => {
    for (const entry of entries) {
      const existing = await db.jobs.get(entry.job.id)
      const existingUpdated = existing?.updatedAt ?? 0
      if (!existing || existingUpdated <= entry.updatedAt) {
        await db.jobs.put({
          ...existing,
          ...entry.job,
          bothCrews: entry.job.crew === 'Both Crews',
          updatedAt: entry.updatedAt,
        })
      }
    }
  })
  return entries.map((entry) => entry.job)
}

const writeRemotePolicyToDexie = async (
  snapshot: DocumentSnapshot<DocumentData> | null,
): Promise<Policy | null> => {
  if (!snapshot || !snapshot.exists()) {
    return null
  }
  const data = snapshot.data() as Record<string, unknown>
  const updatedAt = toMillis(data.updatedAt)
  const policy: Policy = {
    cutoffDateISO: typeof data.cutoffDateISO === 'string' ? data.cutoffDateISO : '2025-12-31',
    blockedClients: Array.isArray(data.blockedClients)
      ? (data.blockedClients as unknown[]).map((value) => String(value)).filter(Boolean)
      : [],
    maxJobsPerDay:
      typeof data.maxJobsPerDay === 'number' && data.maxJobsPerDay > 0
        ? Math.floor(data.maxJobsPerDay)
        : 2,
  }
  const existing = await db.policy.get('org')
  const existingUpdated = (existing?.updatedAt as number | undefined) ?? 0
  if (existingUpdated <= updatedAt) {
    await db.policy.put({
      key: 'org',
      value: policy,
      updatedAt,
    })
  }
  return policy
}

const writeRemoteCollection = async <T extends { id: string; updatedAt: number }>(
  table: DexieTable<T>,
  docs: QueryDocumentSnapshot<DocumentData>[],
  map: (doc: QueryDocumentSnapshot<DocumentData>) => T | null,
) => {
  const entries = docs
    .map((docSnap) => map(docSnap))
    .filter((value): value is T => value !== null)
  await db.transaction('rw', table, async () => {
    for (const entry of entries) {
      const existing = await table.get(entry.id)
      const existingUpdated = existing?.updatedAt ?? 0
      if (!existing || existingUpdated <= entry.updatedAt) {
        await table.put(entry)
      }
    }
  })
}

type FirestoreSubscribeHandlers = {
  onJobs?: (jobs: Job[]) => void
  onPolicy?: (policy: Policy) => void
}

export function subscribeFirestore(handlers: FirestoreSubscribeHandlers = {}): () => void {
  if (!cloudEnabled || !cloudDb) {
    void refreshQueuedCount()
    return () => {}
  }

  void ensureLastSyncLoaded()

  const unsubs: Unsubscribe[] = []
  let cancelled = false

  ;(async () => {
    try {
      setSyncState({ status: 'pulling', lastError: null })
      await ensureAnonAuth()
      if (cancelled) {
        return
      }

      const jobsCollection = collection(cloudDb, 'jobs')
      const initialJobs = await getDocs(jobsCollection)
      const initialJobsList = await writeRemoteJobsToDexie(initialJobs.docs)
      if (!cancelled && initialJobsList.length > 0) {
        handlers.onJobs?.(initialJobsList)
        await recordLastSync(Date.now())
      }
      if (cancelled) {
        return
      }

      unsubs.push(
        onSnapshot(
          query(jobsCollection, orderBy('updatedAt', 'desc')),
          async (snapshot) => {
            if (cancelled) {
              return
            }
            const jobs = await writeRemoteJobsToDexie(snapshot.docs)
            if (!cancelled && jobs.length > 0) {
              handlers.onJobs?.(jobs)
            }
            setSyncState({
              status: getOnlineStatus() ? 'idle' : 'offline',
              lastError: null,
            })
            await recordLastSync(Date.now())
          },
          (error) => {
            console.error('Jobs subscription error', error)
            setSyncState({
              status: 'error',
              lastError: error instanceof Error ? error.message : String(error),
            })
          },
        ),
      )

      const policyDoc = doc(cloudDb, 'config', 'policy')
      const policySnapshot = await getDoc(policyDoc)
      const hydratedPolicy = await writeRemotePolicyToDexie(policySnapshot)
      if (!cancelled && hydratedPolicy) {
        handlers.onPolicy?.(hydratedPolicy)
        await recordLastSync(Date.now())
      }

      unsubs.push(
        onSnapshot(
          policyDoc,
          async (snapshot) => {
            if (cancelled) {
              return
            }
            const policy = await writeRemotePolicyToDexie(snapshot)
            if (!cancelled && policy) {
              handlers.onPolicy?.(policy)
              await recordLastSync(Date.now())
            }
          },
          (error) => {
            console.error('Policy subscription error', error)
            setSyncState({
              status: 'error',
              lastError: error instanceof Error ? error.message : String(error),
            })
          },
        ),
      )

      const kudosCollection = collection(cloudDb, 'kudos')
      unsubs.push(
        onSnapshot(
          kudosCollection,
          async (snapshot) => {
            if (cancelled) {
              return
            }
            await writeRemoteCollection(db.kudos, snapshot.docs, (docSnap) => {
              const data = docSnap.data() as Record<string, unknown>
              return {
                id: docSnap.id,
                imageUrl: (data.imageUrl as string) ?? undefined,
                message: String(data.message ?? ''),
                crewName: String(data.crewName ?? 'Crew'),
                timestamp: toMillis(data.timestamp),
                reactions: (data.reactions as Record<string, number>) ?? {},
                updatedAt: toMillis(data.updatedAt),
              }
            })
          },
          () => {
            /* ignore kudos errors */
          },
        ),
      )

      const usersCollection = collection(cloudDb, 'users')
      unsubs.push(
        onSnapshot(
          usersCollection,
          async (snapshot) => {
            if (cancelled) {
              return
            }
            await writeRemoteCollection(db.users, snapshot.docs, (docSnap) => {
              const data = docSnap.data() as Record<string, unknown>
              return {
                id: docSnap.id,
                displayName: String(data.displayName ?? 'Crew'),
                profileImageUrl: (data.profileImageUrl as string) ?? undefined,
                stats: (data.stats as Record<string, unknown>) ?? {},
                achievements: (data.achievements as Record<string, unknown>) ?? {},
                updatedAt: toMillis(data.updatedAt),
              }
            })
          },
          () => {
            /* ignore users errors */
          },
        ),
      )

      setSyncState({
        status: getOnlineStatus() ? 'idle' : 'offline',
        lastError: null,
      })
    } catch (error) {
      console.error('Firestore bootstrap error', error)
      setSyncState({
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await refreshQueuedCount()
      void scheduleWorker()
    }
  })()

  return () => {
    cancelled = true
    unsubs.forEach((unsub) => unsub())
  }
}

const performJobWrite = async (job: Job, opId: string) => {
  if (!cloudDb) {
    throw new Error('Firestore unavailable')
  }
  const { job: normalized, changes, warnings } = parseJob(job)
  const report: SanitizeReport = { removed: [], changes: [] }
  const sanitized = safeSerialize(normalized, { report })
  const docPath = `jobs/${normalized.id}`
  publishSanitizeDiagnostics(docPath, report, changes, warnings)

  const payload = {
    ...sanitized,
    bothCrews: sanitized.crew === 'Both Crews',
    updatedAt: serverTimestamp(),
    lastOpId: opId,
  }

  await setDoc(doc(cloudDb, 'jobs', String(normalized.id)), payload, { merge: true })
}

const performJobDelete = async (jobId: number) => {
  if (!cloudDb) {
    return
  }
  await deleteDoc(doc(cloudDb, 'jobs', String(jobId))).catch(() => undefined)
}

const performPolicyUpdate = async (policy: Policy, opId: string) => {
  if (!cloudDb) {
    return
  }
  const report: SanitizeReport = { removed: [], changes: [] }
  const sanitized = stripUndefined(policy, report)
  if (report.removed.length > 0) {
    console.warn('[sanitize][policy]', report.removed)
    setSyncState({ lastSanitizedAt: Date.now() })
  }
  await setDoc(
    doc(cloudDb, 'config', 'policy'),
    {
      ...sanitized,
      updatedAt: serverTimestamp(),
      lastOpId: opId,
    },
    { merge: true },
  )
}

const performKudosReact = async (
  kudosId: string,
  emoji: string,
  by: string,
  opId: string,
) => {
  if (!cloudDb) {
    return
  }
  await setDoc(
    doc(cloudDb, 'kudos', kudosId),
    {
      updatedAt: serverTimestamp(),
      lastOpId: opId,
      lastActor: by,
      [`reactions.${emoji}`]: increment(1),
    },
    { merge: true },
  )
}

const performMediaUpload = async (
  mediaId: string,
  jobId: number,
  opId: string,
) => {
  if (!cloudDb || !cloudStorage) {
    throw new Error('Cloud storage unavailable')
  }
  const media = await db.media.get(mediaId)
  if (!media) {
    throw new Error('Local media not found')
  }
  if (!(media.localBlob instanceof Blob)) {
    throw new Error('Local media blob missing')
  }

  const path = media.remoteUrl
    ? media.remoteUrl
    : `jobs/${jobId}/${opId}-${mediaId}`
  const ref = storageRef(cloudStorage, path)
  const uploadTask = uploadBytesResumable(ref, media.localBlob, {
    contentType: media.mime ?? 'application/octet-stream',
  })

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      undefined,
      (error) => reject(error),
      () => resolve(),
    )
  })

  const remoteUrl = await getDownloadURL(uploadTask.snapshot.ref)
  const mediaReport: SanitizeReport = { removed: [], changes: [] }
  const mediaPayload = safeSerialize(
    {
      id: mediaId,
      jobId,
      kind: media.kind,
      mime: media.mime,
      remoteUrl,
      path,
      width: media.width,
      height: media.height,
      name: mediaId,
    },
    { report: mediaReport },
  )
  if (mediaReport.removed.length > 0) {
    console.warn('[sanitize][media]', mediaId, mediaReport)
    setSyncState({ lastSanitizedAt: Date.now() })
  }
  await setDoc(
    doc(cloudDb, 'jobs', String(jobId), 'media', mediaId),
    {
      ...mediaPayload,
      updatedAt: serverTimestamp(),
      lastOpId: opId,
    },
    { merge: true },
  )
  await db.media.update(mediaId, {
    remoteUrl,
    localBlob: undefined,
    localUrl: undefined,
    updatedAt: Date.now(),
  })
}

const runOperation = async (op: PendingOpRecord): Promise<void> => {
  if (!cloudDb) {
    return
  }
  await ensureAnonAuth()
  switch (op.type) {
    case 'job.add':
    case 'job.update': {
      const payload = op.payload as { job?: Job }
      if (payload?.job) {
        await performJobWrite(payload.job, op.id)
      }
      break
    }
    case 'job.delete': {
      const payload = op.payload as { jobId?: number }
      if (typeof payload?.jobId === 'number') {
        await performJobDelete(payload.jobId)
      }
      break
    }
    case 'policy.update': {
      const payload = op.payload as { policy?: Policy }
      if (payload?.policy) {
        await performPolicyUpdate(payload.policy, op.id)
      }
      break
    }
    case 'kudos.react': {
      const payload = op.payload as { kudosId?: string; emoji?: string; by?: string }
      if (payload?.kudosId && payload.emoji) {
        await performKudosReact(payload.kudosId, payload.emoji, payload.by ?? 'Crew', op.id)
      }
      break
    }
    case 'media.upload': {
      const payload = op.payload as { mediaId?: string; jobId?: number }
      if (payload?.mediaId && typeof payload.jobId === 'number') {
        await performMediaUpload(payload.mediaId, payload.jobId, op.id)
      }
      break
    }
    default:
      break
  }
}

export async function processPendingQueue(force = false): Promise<void> {
  if (!cloudEnabled || !cloudDb) {
    return
  }
  await ensureLastSyncLoaded()
  if (!getOnlineStatus()) {
    setSyncState({ status: 'offline' })
    await scheduleWorker()
    return
  }
  if (processing) {
    return
  }
  processing = true
  setSyncState({ status: 'pushing', lastError: null })

  try {
    while (true) {
      const threshold = force ? Number.MAX_SAFE_INTEGER : Date.now()
      const pending = await getPendingOpsDue(threshold)
      if (pending.length === 0) {
        break
      }

      for (const op of pending) {
        try {
          await runOperation(op)
          await deleteByKey('pendingOps', op.id)
          await refreshQueuedCount()
          await recordLastSync(Date.now())
        } catch (error) {
          console.error('Failed pending operation', op, error)
          const delay = computeDelay(op.attempt + 1)
          await updatePendingOp(op.id, {
            attempt: op.attempt + 1,
            nextAt: Date.now() + delay,
          })
          setSyncState({
            status: 'error',
            lastError: error instanceof Error ? error.message : String(error),
          })
          break
        }
      }
      if (getSyncState().status === 'error') {
        break
      }
    }

    if (getSyncState().status !== 'error') {
      setSyncState({
        status: getOnlineStatus() ? 'idle' : 'offline',
        lastError: null,
      })
      await recordLastSync(Date.now())
    }
  } finally {
    processing = false
    await scheduleWorker()
  }
}

export async function triggerManualSync(): Promise<void> {
  await processPendingQueue(true)
}

export async function enqueueSyncOp(op: PendingOpPayload): Promise<void> {
  if (!cloudEnabled || !cloudDb) {
    return
  }
  await ensureLastSyncLoaded()
  const now = Date.now()
  let payload: unknown
  switch (op.type) {
    case 'job.add':
    case 'job.update':
      try {
        const { job: normalized, changes, warnings } = parseJob(op.job)
        const report: SanitizeReport = { removed: [], changes: [] }
        const sanitized = safeSerialize(normalized, { report })
        publishSanitizeDiagnostics(`pendingOps/${sanitized.id}`, report, changes, warnings, {
          skipCache: true,
          notify: false,
        })
        payload = { job: sanitized }
      } catch (error) {
        const docId =
          typeof op.job?.id === 'number' || typeof op.job?.id === 'string'
            ? op.job.id
            : 'unknown'
        const message = `Sync failed: invalid data in “jobs/${docId}”. See console for fields.`
        console.error('Failed to enqueue job operation due to invalid payload', error)
        pushToast(message, 'error')
        setSyncState({ status: 'error', lastError: message })
        if (error instanceof JobValidationError) {
          error.issues.forEach((issue) => {
            console.error('[job-validation]', issue.path.join('.') || '(root)', issue.message)
          })
        }
        throw error
      }
      break
    case 'job.delete':
      payload = { jobId: op.jobId }
      break
    case 'policy.update':
      payload = { policy: op.policy }
      break
    case 'kudos.react':
      payload = { kudosId: op.kudosId, emoji: op.emoji, by: op.by }
      break
    case 'media.upload':
      payload = { mediaId: op.mediaId, jobId: op.jobId }
      break
    case 'custom':
      payload = op.payload
      break
    default:
      payload = op
  }
  const record: PendingOpRecord = {
    id: randomId(),
    type: op.type,
    payload,
    attempt: 0,
    nextAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await addPendingOp(record)
  await refreshQueuedCount()
  if (getOnlineStatus()) {
    void processPendingQueue()
  } else {
    void scheduleWorker()
  }
}

export async function syncNow(): Promise<void> {
  await triggerManualSync()
}
