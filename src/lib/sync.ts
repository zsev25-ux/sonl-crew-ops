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
  setMediaStatus,
  updatePendingOp,
  type PendingOpRecord,
  type PendingOpType,
} from '@/lib/db'
import type { Job, Policy } from '@/lib/types'
import {
  JobValidationError,
  prepareJobForFirestore,
  safePrepareJobForFirestore,
  type JobSanitizationResult,
} from '@/lib/job-schema'
import { safeSerialize, stripUndefined, type SanitizationReport } from '@/lib/sanitize'
import { showToast } from '@/lib/toast'
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
  | { type: 'media.upload'; mediaId: string }
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

const hasToMillis = (value: unknown): value is { toMillis: () => number } =>
  typeof value === 'object' && value !== null && typeof (value as { toMillis?: unknown }).toMillis === 'function'

const toMillisAny = (value: unknown): number | undefined => {
  if (value == null) {
    return undefined
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (hasToMillis(value)) {
    try {
      const millis = value.toMillis()
      return Number.isFinite(millis) ? millis : undefined
    } catch {
      return undefined
    }
  }
  return undefined
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

const sanitizeNoticeCache = new Set<string>()
const schemaWarningCache = new Set<string>()

const extractFieldName = (path: string): string => {
  const stripped = path.replace(/\[.*?\]/g, '')
  const segments = stripped.split('.').filter(Boolean)
  return segments[segments.length - 1] ?? stripped
}

const createSanitizeMessage = (
  docPath: string,
  report: SanitizationReport,
): string | null => {
  if (report.removedPaths.length > 0) {
    const field = extractFieldName(report.removedPaths[0] ?? '')
    return `Sync blocked: invalid field '${field}' (undefined). Fixed automatically and retried.`
  }
  if (report.replacedNumericPaths.length > 0) {
    const field = extractFieldName(report.replacedNumericPaths[0] ?? '')
    return `Sync blocked: invalid number in '${field}'. Fixed automatically and retried.`
  }
  return null
}

const notifySanitizedDoc = (docPath: string, report: SanitizationReport): void => {
  const message = createSanitizeMessage(docPath, report)
  if (!message) {
    return
  }
  setSyncState({ lastError: message, lastSanitizedAt: Date.now() })
  if (!sanitizeNoticeCache.has(docPath)) {
    sanitizeNoticeCache.add(docPath)
    showToast(message, 'warning')
  }
}

const logSchemaWarnings = (docPath: string, warnings: string[]): void => {
  if (warnings.length === 0 || schemaWarningCache.has(docPath)) {
    return
  }
  schemaWarningCache.add(docPath)
  console.warn('[job-schema]', docPath, warnings)
}

const handleValidationFailure = (
  error: JobValidationError,
  docPath: string,
): void => {
  const message =
    error.message || `Sync failed: invalid data in '${docPath}'. See console for fields.`
  console.error('[sync]', message, error.issues)
  setSyncState({ status: 'error', lastError: message })
  showToast(message, 'error')
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

const toMillis = (value: unknown): number => toMillisAny(value) ?? Date.now()

const writeRemoteJobsToDexie = async (
  docs: QueryDocumentSnapshot<DocumentData>[],
): Promise<Job[]> => {
  const entries: { job: Job; updatedAt: number }[] = []

  for (const docSnap of docs) {
    const data = docSnap.data() as Record<string, unknown>
    const docPath = `jobs/${docSnap.id}`
    const normalizedData: Record<string, unknown> = { ...data, id: data.id ?? docSnap.id }

    const timeFields: Array<'updatedAt' | 'createdAt' | 'completedAt'> = [
      'updatedAt',
      'createdAt',
      'completedAt',
    ]

    for (const field of timeFields) {
      const rawValue = data[field]
      const millis = toMillisAny(rawValue)
      if (millis !== undefined) {
        if (hasToMillis(rawValue) && process.env.NODE_ENV === 'development') {
          console.info(`[sync] normalized Firestore Timestamp in ${docPath} ${field}`)
        }
        normalizedData[field] = millis
      }
    }
    const prepared = safePrepareJobForFirestore(normalizedData, { docPath })

    if (!prepared.success) {
      const failure = prepared as { success: false; error: JobValidationError }
      const fieldTypes = timeFields.reduce<Record<string, string>>((acc, field) => {
        const value = normalizedData[field]
        acc[field] = value === null ? 'null' : typeof value
        return acc
      }, {})
      console.error(`[sync] skipped remote job ${docPath}`, {
        fieldTypes,
        issues: failure.error.issues,
      })
      continue
    }

    const { data: sanitized, warnings } = prepared.result
    const updatedAt = toMillis(normalizedData.updatedAt)
    logSchemaWarnings(docPath, warnings)

    const job: Job = {
      id: sanitized.id,
      date: sanitized.date,
      crew: sanitized.crew,
      client: sanitized.client,
      scope: sanitized.scope,
      notes: sanitized.notes,
      address: sanitized.address,
      neighborhood: sanitized.neighborhood,
      zip: sanitized.zip,
      houseTier: sanitized.houseTier,
      rehangPrice: sanitized.rehangPrice ?? undefined,
      lifetimeSpend: sanitized.lifetimeSpend ?? undefined,
      vip: sanitized.vip,
      meta: sanitized.meta,
    }

    entries.push({ job, updatedAt })
    continue
  }

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

const performJobWrite = async (rawJob: unknown, opId: string) => {
  if (!cloudDb) {
    throw new Error('Firestore unavailable')
  }

  const rawId = (rawJob as { id?: unknown })?.id
  const docId =
    typeof rawId === 'number' && Number.isFinite(rawId)
      ? String(rawId)
      : rawId !== undefined
        ? String(rawId)
        : 'unknown'
  const docPath = `jobs/${docId}`

  let prepared: JobSanitizationResult
  try {
    prepared = prepareJobForFirestore(rawJob, { docPath })
  } catch (error) {
    if (error instanceof JobValidationError) {
      handleValidationFailure(error, docPath)
      throw error
    }
    throw error
  }

  const { data: job, warnings, report } = prepared
  logSchemaWarnings(docPath, warnings)
  if (report.removedPaths.length > 0 || report.replacedNumericPaths.length > 0) {
    notifySanitizedDoc(docPath, report)
  }

  const payload = stripUndefined({
    ...job,
    bothCrews: job.crew === 'Both Crews',
    updatedAt: serverTimestamp(),
    lastOpId: opId,
  })

  await setDoc(doc(cloudDb, 'jobs', String(job.id)), payload, { merge: true })
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
  const docPath = 'config/policy'
  const clean = safeSerialize(stripUndefined(policy), { docPath })
  const payload = stripUndefined({
    ...clean,
    updatedAt: serverTimestamp(),
    lastOpId: opId,
  })

  await setDoc(doc(cloudDb, 'config', 'policy'), payload, { merge: true })
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
  const actor = typeof by === 'string' ? by.trim() || 'Crew' : 'Crew'
  const payload = stripUndefined({
    updatedAt: serverTimestamp(),
    lastOpId: opId,
    lastActor: actor,
    [`reactions.${emoji}`]: increment(1),
  })

  await setDoc(doc(cloudDb, 'kudos', kudosId), payload, { merge: true })
}

const processMediaUpload = async (mediaId: string, opId: string) => {
  if (!cloudDb || !cloudStorage) {
    throw new Error('Cloud storage unavailable')
  }

  const media = await db.media.get(mediaId)
  if (!media) {
    await setMediaStatus(mediaId, 'error', { error: 'Local media not found' })
    throw new Error('Local media not found')
  }

  if (!(media.blob instanceof Blob)) {
    await setMediaStatus(mediaId, 'error', { error: 'Local media blob missing' })
    throw new Error('Local media blob missing')
  }

  await ensureAnonAuth()
  const jobKey = media.jobId ?? 'general'
  const storagePath =
    media.remotePath && typeof media.remotePath === 'string'
      ? media.remotePath
      : `media/${jobKey}/${mediaId}-${media.name}`
  const ref = storageRef(cloudStorage, storagePath)

  await setMediaStatus(mediaId, 'uploading', { error: null })

  const uploadTask = uploadBytesResumable(ref, media.blob, {
    contentType: media.type || 'application/octet-stream',
  })

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      undefined,
      async (error) => {
        await setMediaStatus(mediaId, 'error', { error: error.message })
        reject(error)
      },
      () => resolve(),
    )
  })

  const remoteUrl = await getDownloadURL(uploadTask.snapshot.ref)
  const remoteMetadata = {
    remoteUrl,
    remotePath: storagePath,
    error: null as string | null,
  }

  await setMediaStatus(mediaId, 'uploading', remoteMetadata)

  if (media.jobId) {
    try {
      const payload = stripUndefined({
        id: mediaId,
        jobId: media.jobId,
        name: media.name,
        type: media.type,
        size: media.size,
        url: remoteUrl,
        createdAt: serverTimestamp(),
        lastOpId: opId,
      })
      await setDoc(
        doc(cloudDb, 'jobs', String(media.jobId), 'media', mediaId),
        payload,
        { merge: true },
      )
      await setMediaStatus(mediaId, 'synced', remoteMetadata)
      return
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to persist media metadata'
      await setMediaStatus(mediaId, 'error', {
        ...remoteMetadata,
        error: message,
      })
      throw error
    }
  }

  await setMediaStatus(mediaId, 'synced', remoteMetadata)
}

const runOperation = async (op: PendingOpRecord): Promise<void> => {
  if (!cloudDb) {
    return
  }
  await ensureAnonAuth()
  switch (op.type) {
    case 'job.add':
    case 'job.update': {
      const payload = op.payload as { job?: unknown }
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
      const payload = op.payload as { mediaId?: string }
      if (typeof payload?.mediaId === 'string' && payload.mediaId) {
        await processMediaUpload(payload.mediaId, op.id)
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
  setSyncState({ status: 'pushing' })

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
      if (!op.job) {
        return
      }
      {
        const docPath = `jobs/${op.job.id}`
        const prepared = safePrepareJobForFirestore(op.job, { docPath })
        if (!prepared.success) {
          const failure = prepared as { success: false; error: JobValidationError }
          handleValidationFailure(failure.error, docPath)
          return
        }
        const { data, warnings, report } = prepared.result
        logSchemaWarnings(docPath, warnings)
        if (report.removedPaths.length > 0 || report.replacedNumericPaths.length > 0) {
          notifySanitizedDoc(docPath, report)
        }
        payload = { job: data }
      }
      break
    case 'job.delete':
      payload = { jobId: op.jobId }
      break
    case 'policy.update':
      payload = { policy: safeSerialize(stripUndefined(op.policy)) }
      break
    case 'kudos.react':
      payload = {
        kudosId: op.kudosId,
        emoji: op.emoji,
        by: typeof op.by === 'string' ? op.by.trim() : op.by,
      }
      break
    case 'media.upload':
      payload = { mediaId: op.mediaId }
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
    payload: payload ? safeSerialize(payload) : undefined,
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
