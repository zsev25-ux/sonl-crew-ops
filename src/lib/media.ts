import {
  cloudEnabled,
  db as firebaseDb,
  ensureAnonAuth,
  storage as firebaseStorage,
} from '@/lib/firebase'
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import { deleteObject, ref as storageRef } from 'firebase/storage'
import { db, type MediaRecord, type MediaStatus } from '@/lib/db'
import { enqueueSyncOp } from '@/lib/sync'

export type JobMedia = {
  id: string
  jobId: string
  kind: MediaRecord['kind']
  mime: string
  createdAt: number
  src: string
  thumb?: string
  w?: number
  h?: number
  name?: string
  remoteUrl?: string
  localUrl?: string
  status: MediaStatus
  size?: number
}

type CloudMediaDoc = {
  id?: string
  jobId?: string | number
  kind?: MediaRecord['kind']
  mime?: string
  createdAt?: number
  url: string
  thumbUrl?: string
  w?: number
  h?: number
  name?: string
  path?: string
  thumbPath?: string
  size?: number
  remoteUrl?: string
}

const isBrowser = typeof window !== 'undefined'
const hasObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const normalizeJobId = (jobId: string): number => {
  const parsed = Number.parseInt(jobId, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const determineKind = (
  mime: string,
  fallback: MediaRecord['kind'] = 'file',
): MediaRecord['kind'] => {
  if (mime.startsWith('image/')) {
    return 'image'
  }
  if (mime.startsWith('video/')) {
    return 'video'
  }
  return fallback
}

const toJobMedia = (
  record: MediaRecord,
  options: { createPreview?: boolean } = {},
): JobMedia => {
  const { createPreview = true } = options
  const mime = record.type ?? 'application/octet-stream'
  const kind = determineKind(mime, record.kind)
  const shouldPreferLocal =
    !record.remoteUrl ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  let localUrl: string | undefined
  const canCreateLocalUrl =
    createPreview &&
    record.blob instanceof Blob &&
    isBrowser &&
    hasObjectUrl &&
    (shouldPreferLocal || !record.remoteUrl)
  if (canCreateLocalUrl) {
    localUrl = URL.createObjectURL(record.blob)
  }
  const src = shouldPreferLocal && localUrl ? localUrl : record.remoteUrl ?? localUrl ?? ''
  const thumb = kind === 'image' ? record.thumbUrl ?? src : undefined

  return {
    id: record.id,
    jobId: String(record.jobId),
    kind,
    mime,
    createdAt: record.createdAt,
    src,
    thumb,
    w: record.width,
    h: record.height,
    name: record.name,
    remoteUrl: record.remoteUrl,
    localUrl,
    status: record.status,
    size: record.size,
  }
}

const sortMedia = (items: JobMedia[]): JobMedia[] =>
  [...items].sort((a, b) => b.createdAt - a.createdAt)

const ensureUploadQueued = async (mediaId: string, jobId: number): Promise<void> => {
  if (!cloudEnabled) {
    return
  }
  const existing = await db.pendingOps
    .where('type')
    .equals('media.upload')
    .and((op) => {
      const payload = op.payload as { mediaId?: string; jobId?: number } | undefined
      return payload?.mediaId === mediaId && payload?.jobId === jobId
    })
    .first()

  if (!existing) {
    await enqueueSyncOp({ type: 'media.upload', mediaId, jobId })
  }
}

const mergeCloudDoc = async (
  jobId: number,
  docId: string,
  docData: CloudMediaDoc,
): Promise<void> => {
  const existing = await db.media.get(docId)
  const mime =
    typeof docData.mime === 'string' && docData.mime.length > 0
      ? docData.mime
      : existing?.type ?? 'application/octet-stream'
  const createdAt =
    typeof docData.createdAt === 'number' && Number.isFinite(docData.createdAt)
      ? docData.createdAt
      : existing?.createdAt ?? Date.now()
  const kind = determineKind(mime, docData.kind ?? existing?.kind ?? 'file')

  const remoteUrl =
    typeof docData.url === 'string' && docData.url.length > 0
      ? docData.url
      : typeof docData.remoteUrl === 'string' && docData.remoteUrl.length > 0
        ? docData.remoteUrl
        : existing?.remoteUrl

  const merged: MediaRecord = {
    id: docId,
    jobId,
    kind,
    type: mime,
    size: existing?.size ?? docData.size ?? 0,
    blob: existing?.blob,
    remoteUrl,
    thumbUrl: docData.thumbUrl ?? existing?.thumbUrl,
    storagePath: docData.path ?? existing?.storagePath,
    status: 'synced',
    width: docData.w ?? existing?.width,
    height: docData.h ?? existing?.height,
    name: docData.name ?? existing?.name ?? docId,
    createdAt,
    updatedAt: Date.now(),
  }

  await db.media.put(merged)
}

const syncRemoteMedia = async (jobId: number): Promise<void> => {
  if (!cloudEnabled || !firebaseDb) {
    return
  }

  try {
    await ensureAnonAuth()
    const mediaCollection = collection(firebaseDb, 'jobs', String(jobId), 'media')
    const snapshot = await getDocs(query(mediaCollection, orderBy('createdAt', 'desc')))
    await Promise.all(
      snapshot.docs.map((docSnap) =>
        mergeCloudDoc(jobId, docSnap.id, docSnap.data() as CloudMediaDoc),
      ),
    )
  } catch (error) {
    console.warn('Unable to load remote media', error)
  }
}

const saveMediaFile = async (
  jobId: string,
  file: File,
  kind: MediaRecord['kind'],
): Promise<JobMedia> => {
  if (!isBrowser) {
    throw new Error('Media uploads are only available in the browser')
  }

  const jobIdNumber = normalizeJobId(jobId)
  const blob = file.slice(0, file.size, file.type)
  const now = Date.now()
  const id = createId()
  const mime = file.type || (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'application/octet-stream')

  const record: MediaRecord = {
    id,
    jobId: jobIdNumber,
    kind,
    type: mime,
    size: blob.size,
    blob,
    status: 'pending',
    name: file.name,
    createdAt: now,
    updatedAt: now,
  }

  await db.media.put(record)
  await ensureUploadQueued(id, jobIdNumber)

  return toJobMedia(record, { createPreview: false })
}

export async function saveImage(jobId: string, file: File): Promise<JobMedia> {
  return saveMediaFile(jobId, file, 'image')
}

export async function saveVideo(jobId: string, file: File): Promise<JobMedia> {
  return saveMediaFile(jobId, file, 'video')
}

const loadJobMedia = async (jobId: number): Promise<JobMedia[]> => {
  const records = await db.media.where('jobId').equals(jobId).toArray()
  return sortMedia(records.map((record) => toJobMedia(record)))
}

export async function listMedia(jobId: string): Promise<JobMedia[]> {
  const jobIdNumber = normalizeJobId(jobId)
  await syncRemoteMedia(jobIdNumber)
  return loadJobMedia(jobIdNumber)
}

const deleteMediaFromFirebase = async (
  jobId: string,
  id: string,
  storageHint?: string | null,
): Promise<void> => {
  if (!firebaseDb || !firebaseStorage) {
    return
  }

  await ensureAnonAuth()
  const dbInstance = firebaseDb
  const storageInstance = firebaseStorage
  const mediaDocRef = doc(dbInstance, 'jobs', jobId, 'media', id)
  const snapshot = await getDoc(mediaDocRef)

  let data: CloudMediaDoc | null = null
  if (snapshot.exists()) {
    data = snapshot.data() as CloudMediaDoc
  }

  const targets = [
    storageHint ?? undefined,
    data?.path,
    data?.thumbPath,
    data?.url && !data?.path ? data.url : undefined,
    data?.thumbUrl && !data?.thumbPath ? data.thumbUrl : undefined,
  ].filter((value): value is string => Boolean(value))

  await Promise.all(
    targets.map((targetPath) =>
      deleteObject(storageRef(storageInstance, targetPath)).catch(() => undefined),
    ),
  )

  await deleteDoc(mediaDocRef).catch(() => undefined)
}

export async function deleteMedia(jobId: string, id: string): Promise<void> {
  const jobIdNumber = normalizeJobId(jobId)
  const record = await db.media.get(id)

  if (cloudEnabled) {
    await db.pendingOps
      .where('type')
      .equals('media.upload')
      .and((op) => {
        const payload = op.payload as { mediaId?: string } | undefined
        return payload?.mediaId === id
      })
      .delete()
  }

  await db.media.delete(id)

  if (
    cloudEnabled &&
    (record?.status === 'synced' || record?.remoteUrl || record?.storagePath)
  ) {
    await deleteMediaFromFirebase(String(jobIdNumber), id, record?.storagePath)
  }
}

export function revokeMediaUrls(items: JobMedia[]): void {
  if (!isBrowser || !hasObjectUrl) {
    return
  }

  items.forEach((item) => {
    if (item.localUrl && item.localUrl.startsWith('blob:')) {
      URL.revokeObjectURL(item.localUrl)
    } else if (!item.remoteUrl && item.src.startsWith('blob:')) {
      URL.revokeObjectURL(item.src)
    }
  })
}

export async function listLocalMedia(jobId: string): Promise<JobMedia[]> {
  const jobIdNumber = normalizeJobId(jobId)
  const records = await db.media
    .where('jobId')
    .equals(jobIdNumber)
    .and((record) => record.status !== 'synced')
    .toArray()

  return sortMedia(records.map((record) => toJobMedia(record)))
}

export async function migrateLocalMediaToCloud(jobId: string): Promise<JobMedia[]> {
  const jobIdNumber = normalizeJobId(jobId)
  const pending = await db.media
    .where('jobId')
    .equals(jobIdNumber)
    .and((record) => record.status !== 'synced')
    .toArray()

  await Promise.all(pending.map((record) => ensureUploadQueued(record.id, jobIdNumber)))

  return sortMedia(pending.map((record) => toJobMedia(record)))
}
