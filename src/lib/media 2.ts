import { get, set } from 'idb-keyval'

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
}

type StoredMediaRecord = JobMedia & {
  blobData?: Blob
}

const MEDIA_KEY_PREFIX = 'media:'
const IMAGE_MAX_EDGE = 1600
const THUMB_MAX_EDGE = 320
const IMAGE_OUTPUT_QUALITY = 0.82

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

export async function listMedia(jobId: string): Promise<JobMedia[]> {
  const stored = await loadRecords(jobId)
  return stored.map((entry) => toRenderable(entry))
}

export async function deleteMedia(jobId: string, id: string): Promise<void> {
  const existing = await loadRecords(jobId)
  const filtered = existing.filter((item) => item.id !== id)
  await persistRecords(jobId, filtered)
}

export function revokeMediaUrls(items: JobMedia[]): void {
  releaseObjectUrls(items)
}
