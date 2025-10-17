import {
  cloudEnabled,
  db as cloudDb,
  ensureAnonAuth,
  storage as cloudStorage,
} from '@/lib/firebase'
import {
  addLocalMedia as addLocalMediaRecord,
  db,
  generateMediaId,
  setMediaStatus,
  type MediaRecord,
  type MediaRow,
  type MediaStatus,
} from '@/lib/db'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { deleteObject, ref as storageRef } from 'firebase/storage'

export type JobMedia = MediaRow & {
  previewUrl?: string
}

const isBrowser = typeof window !== 'undefined'

const toJobId = (jobId?: string): string | undefined =>
  typeof jobId === 'string' && jobId.length > 0 ? jobId : undefined

const mapRecordToMedia = async (record: MediaRow): Promise<JobMedia> => {
  let localUrl = typeof record.localUrl === 'string' ? record.localUrl : undefined
  if (record.blob instanceof Blob && isBrowser) {
    if (localUrl) {
      try {
        URL.revokeObjectURL(localUrl)
      } catch (error) {
        console.warn('Failed to revoke cached media URL', error)
      }
    }
    localUrl = URL.createObjectURL(record.blob)
    await db.media.update(record.id, { localUrl })
  }

  const previewUrl = localUrl ?? (record.remoteUrl ?? undefined)

  return {
    ...record,
    localUrl: localUrl ?? null,
    previewUrl,
  }
}

const sortMedia = (items: JobMedia[]): JobMedia[] =>
  [...items].sort((a, b) => a.createdAt - b.createdAt)

export async function addLocalMedia(
  file: File,
  jobId?: string,
  status: MediaStatus = cloudEnabled ? 'queued' : 'local',
): Promise<string> {
  const id = await addLocalMediaRecord(file, toJobId(jobId))
  await setMediaStatus(id, status)
  if (isBrowser) {
    const localUrl = URL.createObjectURL(file)
    await db.media.update(id, { localUrl })
  }
  return id
}

export async function listMedia(jobId: string): Promise<JobMedia[]> {
  const jobKey = toJobId(jobId)
  const records = jobKey
    ? await db.media.where('jobId').equals(jobKey).sortBy('createdAt')
    : await db.media
        .orderBy('createdAt')
        .filter((record) => !record.jobId)
        .toArray()

  const mapped = await Promise.all(records.map((record) => mapRecordToMedia(record)))
  return sortMedia(mapped)
}

export async function deleteMedia(id: string): Promise<void> {
  const record = await db.media.get(id)
  if (!record) {
    return
  }

  if (typeof record.localUrl === 'string' && isBrowser) {
    URL.revokeObjectURL(record.localUrl)
  }

  await db.media.delete(id)

  if (cloudEnabled && cloudDb && record.jobId) {
    await ensureAnonAuth().catch(() => undefined)
    await deleteDoc(doc(cloudDb, 'jobs', String(record.jobId), 'media', id)).catch(
      () => undefined,
    )
  }

  if (cloudEnabled && cloudStorage && record.remotePath) {
    await deleteObject(storageRef(cloudStorage, record.remotePath)).catch(() => undefined)
  }
}

export function revokeMediaUrls(items: JobMedia[]): void {
  if (!isBrowser) {
    return
  }
  for (const item of items) {
    if (item.localUrl) {
      try {
        URL.revokeObjectURL(item.localUrl)
      } catch (error) {
        console.warn('Failed to revoke object URL', error)
      }
    }
    if (item.previewUrl && item.previewUrl === item.localUrl) {
      try {
        URL.revokeObjectURL(item.previewUrl)
      } catch (error) {
        console.warn('Failed to revoke preview URL', error)
      }
    }
  }
}

const fetchRemoteMediaDocs = async (
  jobId: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> => {
  if (!cloudEnabled || !cloudDb) {
    return []
  }
  await ensureAnonAuth()
  const mediaCollection = collection(cloudDb, 'jobs', jobId, 'media')
  const snapshot = await getDocs(query(mediaCollection, orderBy('createdAt', 'asc')))
  return snapshot.docs
}

export async function syncRemoteMedia(jobId: string): Promise<void> {
  const docs = await fetchRemoteMediaDocs(jobId)
  if (docs.length === 0) {
    return
  }

  const existing = await db.media.where('jobId').equals(jobId).toArray()
  const existingById = new Map<string, string>()
  const existingKeys = new Map<string, string>()
  for (const record of existing) {
    existingById.set(record.id, record.id)
    if (typeof record.remotePath === 'string') {
      existingKeys.set(record.remotePath, record.id)
    } else if (typeof record.remoteUrl === 'string') {
      existingKeys.set(record.remoteUrl, record.id)
    }
  }

  for (const docSnap of docs) {
    const data = docSnap.data() as Record<string, unknown>
    const remoteUrl = typeof data.url === 'string' ? data.url : undefined
    if (!remoteUrl) {
      continue
    }
    const remoteKey =
      typeof data.path === 'string'
        ? (data.path as string)
        : typeof data.storagePath === 'string'
          ? (data.storagePath as string)
          : docSnap.id
    const targetId = existingById.get(docSnap.id) ?? existingKeys.get(remoteKey)

    if (typeof targetId === 'string') {
      await db.media.update(targetId, {
        remoteUrl,
        remotePath: remoteKey,
        status: 'synced',
        jobId,
        name: typeof data.name === 'string' ? data.name : docSnap.id,
        type: typeof data.type === 'string' ? data.type : 'application/octet-stream',
        size: typeof data.size === 'number' ? data.size : 0,
        createdAt:
          typeof data.createdAt === 'number'
            ? (data.createdAt as number)
            : Date.now(),
        updatedAt: Date.now(),
      })
      existingKeys.set(remoteKey, targetId)
      continue
    }

    const newId = docSnap.id || generateMediaId()
    const record: MediaRecord = {
      id: newId,
      jobId,
      name: typeof data.name === 'string' ? data.name : docSnap.id,
      type: typeof data.type === 'string' ? data.type : 'application/octet-stream',
      size: typeof data.size === 'number' ? data.size : 0,
      blob: null,
      localUrl: null,
      remoteUrl,
      remotePath: remoteKey,
      status: 'synced',
      error: null,
      createdAt:
        typeof data.createdAt === 'number' ? (data.createdAt as number) : Date.now(),
      updatedAt: Date.now(),
    }
    await db.media.put(record)
    existingKeys.set(remoteKey, newId)
    existingById.set(newId, newId)
  }
}
