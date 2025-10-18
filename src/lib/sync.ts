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
} from '@/lib/db'
import type { AwardDocument, CrewUser, Job, Policy } from '@/lib/types'
import { normalizeJobMeta } from '@/lib/jobmeta'
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
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'

type SyncStatus = 'offline' | 'idle' | 'pushing' | 'pulling' | 'error'

const LAST_SYNC_KEY = 'sync:lastSuccess'

export type SyncState = {
  status: SyncStatus
  queued: number
  lastError: string | null
  lastSyncedAt: number | null
}

export type PendingOpPayload =
  | { type: 'job.add'; job: Job }
  | { type: 'job.update'; job: Job }
  | { type: 'job.delete'; jobId: number }
  | { type: 'policy.update'; policy: Policy }
  | { type: 'kudos.react'; kudosId: string; emoji: string; by: string }
  | { type: 'media.upload'; mediaId: string; jobId: number }
  | { type: 'user.update'; userId: string; changes: Partial<CrewUser> }
  | { type: 'user.avatar.upload'; userId: string; dataUrl: string; contentType?: string }
  | { type: 'award.grant'; award: AwardDocument }
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
  const seasonData =
    data.season && typeof data.season === 'object'
      ? {
          id: String((data.season as Record<string, unknown>).id ?? 'season'),
          start: toMillis((data.season as Record<string, unknown>).start),
          end: toMillis((data.season as Record<string, unknown>).end),
        }
      : undefined
  const leaderboardCategories = Array.isArray(data.leaderboardCategories)
    ? (data.leaderboardCategories as Record<string, unknown>[]).map((entry) => ({
        key: String(entry.key ?? 'kudos'),
        label: String(entry.label ?? 'Leaderboard'),
        field: String(entry.field ?? 'stats.kudos'),
        higherIsBetter: entry.higherIsBetter !== false,
      }))
    : undefined
  const awardRules = Array.isArray(data.awardRules)
    ? (data.awardRules as Record<string, unknown>[]).map((entry) => ({
        key: String(entry.key ?? 'award'),
        title: String(entry.title ?? 'Award'),
        criteria:
          entry.criteria && typeof entry.criteria === 'object'
            ? (entry.criteria as Record<string, unknown>)
            : {},
      }))
    : undefined

  const policy: Policy = {
    cutoffDateISO: typeof data.cutoffDateISO === 'string' ? data.cutoffDateISO : '2025-12-31',
    blockedClients: Array.isArray(data.blockedClients)
      ? (data.blockedClients as unknown[]).map((value) => String(value)).filter(Boolean)
      : [],
    maxJobsPerDay:
      typeof data.maxJobsPerDay === 'number' && data.maxJobsPerDay > 0
        ? Math.floor(data.maxJobsPerDay)
        : 2,
    season: seasonData,
    leaderboardCategories,
    awardRules,
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
                displayName: String(data.displayName ?? 'Crew Member'),
                role: (data.role as 'crew' | 'admin' | 'owner') ?? 'crew',
                bio: typeof data.bio === 'string' ? data.bio : undefined,
                photoURL:
                  (data.photoURL as string) ?? (data.profileImageUrl as string) ?? undefined,
                stats: (data.stats as Record<string, unknown>) ?? {},
                season:
                  data.season && typeof data.season === 'object'
                    ? (data.season as Record<string, unknown>)
                    : undefined,
                createdAt:
                  data.createdAt !== undefined
                    ? toMillis(data.createdAt as Timestamp | number)
                    : undefined,
                updatedAt: toMillis(data.updatedAt),
              }
            })
          },
          () => {
            /* ignore users errors */
          },
        ),
      )

      const awardsCollection = collection(cloudDb, 'awards')
      unsubs.push(
        onSnapshot(
          awardsCollection,
          async (snapshot) => {
            if (cancelled) {
              return
            }
            await writeRemoteCollection(db.awards, snapshot.docs, (docSnap) => {
              const data = docSnap.data() as Record<string, unknown>
              return {
                id: docSnap.id,
                userRefId: String((data.userRefId ?? data.userId) ?? ''),
                seasonId: String(data.seasonId ?? ''),
                key: String(data.key ?? ''),
                title: String(data.title ?? ''),
                icon: (data.icon as string) ?? undefined,
                earnedAt: toMillis(data.earnedAt),
                updatedAt: toMillis(data.updatedAt),
              }
            })
          },
          () => {
            /* ignore awards errors */
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
  const target = doc(cloudDb, 'jobs', String(job.id))
  const jobPayload: Job = {
    ...job,
    meta: job.meta ? normalizeJobMeta(job.meta) : undefined,
  }
  await setDoc(
    target,
    {
      ...jobPayload,
      bothCrews: jobPayload.crew === 'Both Crews',
      updatedAt: serverTimestamp(),
      lastOpId: opId,
    },
    { merge: true },
  )
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
  await setDoc(
    doc(cloudDb, 'config', 'policy'),
    {
      ...policy,
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
  await setDoc(
    doc(cloudDb, 'jobs', String(jobId), 'media', mediaId),
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

const performUserDocumentUpdate = async (
  userId: string,
  changes: Partial<CrewUser>,
  opId: string,
) => {
  if (!cloudDb) {
    return
  }
  await setDoc(
    doc(cloudDb, 'users', userId),
    {
      ...changes,
      updatedAt: serverTimestamp(),
      lastOpId: opId,
    },
    { merge: true },
  )
}

const dataUrlToBlob = async (dataUrl: string, contentType?: string): Promise<Blob> => {
  if (dataUrl.startsWith('data:')) {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    if (contentType && blob.type !== contentType) {
      return blob.slice(0, blob.size, contentType)
    }
    return blob
  }
  const binary = atob(dataUrl)
  const array = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    array[index] = binary.charCodeAt(index)
  }
  return new Blob([array], { type: contentType ?? 'application/octet-stream' })
}

const performUserAvatarUpload = async (
  userId: string,
  dataUrl: string,
  contentType: string | undefined,
  opId: string,
) => {
  if (!cloudDb || !cloudStorage) {
    return
  }
  const blob = await dataUrlToBlob(dataUrl, contentType)
  const path = `avatars/${userId}/${opId}.jpg`
  const ref = storageRef(cloudStorage, path)
  await uploadBytes(ref, blob, {
    contentType: contentType ?? blob.type ?? 'image/jpeg',
  })
  const url = await getDownloadURL(ref)
  await setDoc(
    doc(cloudDb, 'users', userId),
    {
      photoURL: url,
      updatedAt: serverTimestamp(),
      lastOpId: opId,
    },
    { merge: true },
  )
  await db.users.update(userId, { photoURL: url, updatedAt: Date.now() })
}

const performAwardGrant = async (award: AwardDocument, opId: string) => {
  if (!cloudDb) {
    return
  }
  const awardId = award.id || `${award.userRefId}-${award.key}-${award.seasonId}`
  await setDoc(
    doc(cloudDb, 'awards', awardId),
    {
      ...award,
      id: awardId,
      updatedAt: serverTimestamp(),
      lastOpId: opId,
    },
    { merge: true },
  )
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
    case 'user.update': {
      const payload = op.payload as { userId?: string; changes?: Partial<CrewUser> }
      if (payload?.userId && payload.changes) {
        await performUserDocumentUpdate(payload.userId, payload.changes, op.id)
      }
      break
    }
    case 'user.avatar.upload': {
      const payload = op.payload as { userId?: string; dataUrl?: string; contentType?: string }
      if (payload?.userId && payload.dataUrl) {
        await performUserAvatarUpload(payload.userId, payload.dataUrl, payload.contentType, op.id)
      }
      break
    }
    case 'award.grant': {
      const payload = op.payload as { award?: AwardDocument }
      if (payload?.award) {
        await performAwardGrant(payload.award, op.id)
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
      payload = {
        job: {
          ...op.job,
          meta: op.job.meta ? normalizeJobMeta(op.job.meta) : undefined,
        },
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
    case 'user.update':
      payload = { userId: op.userId, changes: op.changes }
      break
    case 'user.avatar.upload':
      payload = {
        userId: op.userId,
        dataUrl: op.dataUrl,
        contentType: op.contentType,
      }
      break
    case 'award.grant':
      payload = { award: op.award }
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
