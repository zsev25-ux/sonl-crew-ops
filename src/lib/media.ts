import { get, set } from 'idb-keyval'
import {
  cloudEnabled,
  db as firebaseDb,
  ensureAnonAuth,
  storage as firebaseStorage,
} from '@/lib/firebase'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { safeSerialize, type SanitizeReport } from '@/lib/sanitize'

export type JobMedia = {
  id: string
  jobId: string
  kind: 'image' | 'video'
  mime: string
  createdAt: number
  src: string
  thumb?: string
  w?: number
  h?: number
  name?: string
  path?: string
  thumbPath?: string
}

type StoredMediaRecord = JobMedia & {
  blobData?: Blob
}

type CloudMediaDoc = {
  id: string
  jobId: string
  kind: 'image' | 'video'
  mime: string
  createdAt: number
  url: string
  thumbUrl?: string
  w?: number
  h?: number
  name?: string
  path?: string
  thumbPath?: string
}

const MEDIA_KEY_PREFIX = 'media:'
const IMAGE_MAX_EDGE = 1600
const THUMB_MAX_EDGE = 320
const IMAGE_OUTPUT_QUALITY = 0.82

const mediaBackend: 'firebase' | 'idb' =
  cloudEnabled && firebaseDb && firebaseStorage ? 'firebase' : 'idb'

const isBrowser =
  typeof window !== 'undefined' && typeof document !== 'undefined'

const getStoreKey = (jobId: string): string => `${MEDIA_KEY_PREFIX}${jobId}`

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const readFileAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.readAsDataURL(file)
  })

const clampDimensions = (
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } => {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width, height }
  }
  const ratio = maxEdge / longest
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  }
}

const drawToCanvas = async (
  image: HTMLImageElement,
  maxEdge: number,
  mimeType: string,
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> => {
  if (!isBrowser) {
    return {
      dataUrl: '',
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
  }

  const { width, height } = clampDimensions(
    image.naturalWidth,
    image.naturalHeight,
    maxEdge,
  )

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas context not available')
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const outputType = mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
  const dataUrl = canvas.toDataURL(outputType, quality)

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
  }
}

const createImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image for processing'))
    image.src = src
  })

const dataUrlToBlob = async (
  dataUrl: string,
  fallbackMime: string,
): Promise<Blob> => {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  if (blob.type) {
    return blob
  }
  const arrayBuffer = await blob.arrayBuffer()
  return new Blob([arrayBuffer], { type: fallbackMime })
}

const loadRecords = async (jobId: string): Promise<StoredMediaRecord[]> => {
  const key = getStoreKey(jobId)
  const stored = await get<StoredMediaRecord[]>(key)
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.map((entry) => ({ ...entry }))
}

const persistRecords = async (
  jobId: string,
  records: StoredMediaRecord[],
): Promise<void> => {
  await set(getStoreKey(jobId), records)
}

const removeLocalRecord = async (jobId: string, id: string): Promise<void> => {
  const existing = await loadRecords(jobId)
  const filtered = existing.filter((item) => item.id !== id)
  await persistRecords(jobId, filtered)
}

const toRenderable = (record: StoredMediaRecord): JobMedia => {
  if (record.kind === 'video' && record.blobData instanceof Blob) {
    const blob = record.blobData
    const objectUrl = URL.createObjectURL(blob)
    return {
      id: record.id,
      jobId: record.jobId,
      kind: 'video',
      mime: record.mime,
      createdAt: record.createdAt,
      src: objectUrl,
      thumb: record.thumb,
      w: record.w,
      h: record.h,
      name: record.name,
    }
  }

  return {
    id: record.id,
    jobId: record.jobId,
    kind: record.kind,
    mime: record.mime,
    createdAt: record.createdAt,
    src: record.src,
    thumb: record.thumb,
    w: record.w,
    h: record.h,
    name: record.name,
  }
}

const releaseObjectUrls = (records: JobMedia[]): void => {
  if (!isBrowser) {
    return
  }

  records.forEach((item) => {
    if (item.kind === 'video' && item.src.startsWith('blob:')) {
      URL.revokeObjectURL(item.src)
    }
  })
}

const sortMedia = (items: JobMedia[]): JobMedia[] =>
  [...items].sort((a, b) => b.createdAt - a.createdAt)

const uploadImageToFirebase = async (params: {
  jobId: string
  name?: string
  dataUrl: string
  thumbDataUrl: string
  width?: number
  height?: number
}): Promise<JobMedia> => {
  if (!firebaseDb || !firebaseStorage) {
    throw new Error('Firebase is not configured')
  }

  const dbInstance = firebaseDb
  const storageInstance = firebaseStorage

  await ensureAnonAuth()

  const id = createId()
  const createdAt = Date.now()
  const mime = 'image/jpeg'
  const imagePath = `media/${params.jobId}/${id}.jpg`
  const thumbPath = `media/${params.jobId}/${id}.thumb.jpg`

  const [imageBlob, thumbBlob] = await Promise.all([
    dataUrlToBlob(params.dataUrl, mime),
    dataUrlToBlob(params.thumbDataUrl, mime),
  ])

  const mainRef = storageRef(storageInstance, imagePath)
  const thumbRef = storageRef(storageInstance, thumbPath)

  await uploadBytes(mainRef, imageBlob, { contentType: mime })
  await uploadBytes(thumbRef, thumbBlob, { contentType: mime })

  const [url, thumbUrl] = await Promise.all([
    getDownloadURL(mainRef),
    getDownloadURL(thumbRef),
  ])

  const mediaDoc: CloudMediaDoc = {
    id,
    jobId: params.jobId,
    kind: 'image',
    mime,
    createdAt,
    url,
    thumbUrl,
    w: params.width,
    h: params.height,
    name: params.name,
    path: imagePath,
    thumbPath,
  }

  const report: SanitizeReport = { removed: [], changes: [] }
  const cleanDoc = safeSerialize(mediaDoc, { report })
  if (report.removed.length > 0) {
    console.warn('[sanitize][media:image]', id, report)
  }

  await setDoc(
    doc(collection(dbInstance, 'jobs', params.jobId, 'media'), id),
    cleanDoc,
  )

  return {
    id,
    jobId: params.jobId,
    kind: 'image',
    mime,
    createdAt,
    src: url,
    thumb: thumbUrl,
    w: params.width,
    h: params.height,
    name: params.name,
    path: imagePath,
    thumbPath,
  }
}

const determineExtension = (name?: string, mime?: string): string => {
  const trimmed = (name ?? '').toLowerCase()
  if (trimmed.includes('.')) {
    const ext = trimmed.split('.').pop()
    if (ext) {
      return ext
    }
  }
  const mimeExt = (mime ?? '').split('/')[1]
  if (mimeExt) {
    return mimeExt
  }
  return 'mp4'
}

const uploadVideoToFirebase = async (params: {
  jobId: string
  blob: Blob
  mime: string
  name?: string
}): Promise<JobMedia> => {
  if (!firebaseDb || !firebaseStorage) {
    throw new Error('Firebase is not configured')
  }

  const dbInstance = firebaseDb
  const storageInstance = firebaseStorage

  await ensureAnonAuth()

  const id = createId()
  const createdAt = Date.now()
  const extension = determineExtension(params.name, params.mime)
  const mime = params.mime || 'video/mp4'
  const videoPath = `media/${params.jobId}/${id}.${extension}`
  const fileRef = storageRef(storageInstance, videoPath)

  await uploadBytes(fileRef, params.blob, { contentType: mime })
  const url = await getDownloadURL(fileRef)

  const mediaDoc: CloudMediaDoc = {
    id,
    jobId: params.jobId,
    kind: 'video',
    mime,
    createdAt,
    url,
    name: params.name,
    path: videoPath,
  }

  const report: SanitizeReport = { removed: [], changes: [] }
  const cleanDoc = safeSerialize(mediaDoc, { report })
  if (report.removed.length > 0) {
    console.warn('[sanitize][media:video]', id, report)
  }

  await setDoc(
    doc(collection(dbInstance, 'jobs', params.jobId, 'media'), id),
    cleanDoc,
  )

  return {
    id,
    jobId: params.jobId,
    kind: 'video',
    mime,
    createdAt,
    src: url,
    name: params.name,
    path: videoPath,
  }
}

export async function saveImage(jobId: string, file: File): Promise<JobMedia> {
  if (!isBrowser) {
    throw new Error('Image processing is only available in the browser')
  }

  const dataUrl = await readFileAsDataURL(file)
  const image = await createImageElement(dataUrl)

  const main = await drawToCanvas(
    image,
    IMAGE_MAX_EDGE,
    file.type || 'image/jpeg',
    IMAGE_OUTPUT_QUALITY,
  )

  const thumb = await drawToCanvas(
    image,
    THUMB_MAX_EDGE,
    'image/jpeg',
    IMAGE_OUTPUT_QUALITY,
  )

  if (mediaBackend === 'firebase' && firebaseDb && firebaseStorage) {
    return uploadImageToFirebase({
      jobId,
      name: file.name,
      dataUrl: main.dataUrl,
      thumbDataUrl: thumb.dataUrl,
      width: main.width,
      height: main.height,
    })
  }

  const id = createId()
  const entry: StoredMediaRecord = {
    id,
    jobId,
    kind: 'image',
    mime: file.type || 'image/jpeg',
    createdAt: Date.now(),
    src: main.dataUrl,
    thumb: thumb.dataUrl,
    w: main.width,
    h: main.height,
    name: file.name,
  }

  const existing = await loadRecords(jobId)
  existing.push(entry)
  await persistRecords(jobId, existing)

  return toRenderable(entry)
}

export async function saveVideo(jobId: string, file: File): Promise<JobMedia> {
  if (!isBrowser) {
    throw new Error('Video uploads are only available in the browser')
  }

  const blob = file.slice(0, file.size, file.type)

  if (mediaBackend === 'firebase' && firebaseDb && firebaseStorage) {
    return uploadVideoToFirebase({
      jobId,
      blob,
      mime: file.type || 'video/mp4',
      name: file.name,
    })
  }

  const id = createId()
  const stored: StoredMediaRecord = {
    id,
    jobId,
    kind: 'video',
    mime: file.type || 'video/mp4',
    createdAt: Date.now(),
    src: '',
    name: file.name,
    blobData: blob,
  }

  const existing = await loadRecords(jobId)
  existing.push(stored)
  await persistRecords(jobId, existing)

  return toRenderable(stored)
}

const mapCloudDocToMedia = (docId: string, docData: CloudMediaDoc): JobMedia => ({
  id: docData.id || docId,
  jobId: docData.jobId,
  kind: docData.kind === 'video' ? 'video' : 'image',
  mime: docData.mime,
  createdAt:
    typeof docData.createdAt === 'number' && Number.isFinite(docData.createdAt)
      ? docData.createdAt
      : Date.now(),
  src: docData.url,
  thumb: docData.thumbUrl,
  w: docData.w,
  h: docData.h,
  name: docData.name,
  path: docData.path,
  thumbPath: docData.thumbPath,
})

const listMediaFromFirebase = async (jobId: string): Promise<JobMedia[]> => {
  if (!firebaseDb) {
    return []
  }

  await ensureAnonAuth()
  const mediaCollection = collection(firebaseDb, 'jobs', jobId, 'media')
  const snapshot = await getDocs(
    query(mediaCollection, orderBy('createdAt', 'desc')),
  )

  const items: JobMedia[] = []
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as CloudMediaDoc
    if (data && typeof data.url === 'string' && data.url) {
      items.push(mapCloudDocToMedia(docSnap.id, data))
    }
  })
  return items
}

const deleteMediaFromFirebase = async (
  jobId: string,
  id: string,
): Promise<void> => {
  if (!firebaseDb || !firebaseStorage) {
    return
  }

  const dbInstance = firebaseDb
  const storageInstance = firebaseStorage

  await ensureAnonAuth()
  const mediaDocRef = doc(dbInstance, 'jobs', jobId, 'media', id)
  const snapshot = await getDoc(mediaDocRef)
  if (snapshot.exists()) {
    const data = snapshot.data() as CloudMediaDoc
    const targets = [
      data?.path,
      data?.thumbPath,
      data?.url && !data.path ? data.url : undefined,
      data?.thumbUrl && !data.thumbPath ? data.thumbUrl : undefined,
    ].filter((value): value is string => Boolean(value))

    await Promise.all(
      targets.map((targetPath) =>
        deleteObject(storageRef(storageInstance, targetPath)).catch(() => {
          // Ignore deletion failures; the document removal still proceeds.
        }),
      ),
    )
  }

  await deleteDoc(mediaDocRef)
}

export async function listMedia(jobId: string): Promise<JobMedia[]> {
  if (mediaBackend === 'firebase') {
    const items = await listMediaFromFirebase(jobId)
    return sortMedia(items)
  }

  const stored = await loadRecords(jobId)
  return sortMedia(stored.map((entry) => toRenderable(entry)))
}

export async function deleteMedia(jobId: string, id: string): Promise<void> {
  if (mediaBackend === 'firebase') {
    await deleteMediaFromFirebase(jobId, id)
    await removeLocalRecord(jobId, id)
    return
  }

  await removeLocalRecord(jobId, id)
}

export function revokeMediaUrls(items: JobMedia[]): void {
  releaseObjectUrls(items)
}

export async function listLocalMedia(jobId: string): Promise<JobMedia[]> {
  const stored = await loadRecords(jobId)
  return sortMedia(stored.map((entry) => toRenderable(entry)))
}

export async function migrateLocalMediaToCloud(
  jobId: string,
): Promise<JobMedia[]> {
  if (mediaBackend !== 'firebase' || !firebaseDb || !firebaseStorage) {
    return []
  }

  const localRecords = await loadRecords(jobId)
  if (localRecords.length === 0) {
    return []
  }

  const migrated: JobMedia[] = []
  await ensureAnonAuth()

  for (const record of localRecords) {
    try {
      if (record.kind === 'image' && record.src && record.thumb) {
        const uploaded = await uploadImageToFirebase({
          jobId,
          name: record.name,
          dataUrl: record.src,
          thumbDataUrl: record.thumb,
          width: record.w,
          height: record.h,
        })
        migrated.push(uploaded)
      } else if (record.kind === 'video' && record.blobData instanceof Blob) {
        const uploaded = await uploadVideoToFirebase({
          jobId,
          blob: record.blobData,
          mime: record.mime,
          name: record.name,
        })
        migrated.push(uploaded)
      }
    } catch (error) {
      console.error('Failed to migrate media item', error)
    }
  }

  await persistRecords(jobId, [])
  return sortMedia(migrated)
}
