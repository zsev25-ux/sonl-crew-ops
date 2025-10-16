export type JobMaterials = {
  zWireFt: number
  malePlugs: number
  femalePlugs: number
  timers: number
}

export type JobMeta = {
  roofType?: 'single-story' | 'two-story' | 'steep' | 'flat'
  colorPattern?: string
  powerNotes?: string
  hazards?: string
  gateCode?: string
  contactPhone?: string
  materials: JobMaterials
  status: 'Not started' | 'In progress' | 'Done'
  finishedAt: number | null
  crewNotes?: string
  migrated: boolean
}

const MATERIAL_FIELD_CONFIG: Record<
  keyof JobMaterials,
  { integer: boolean }
> = {
  zWireFt: { integer: false },
  malePlugs: { integer: true },
  femalePlugs: { integer: true },
  timers: { integer: true },
}

export const createDefaultMaterials = (): JobMaterials => ({
  zWireFt: 0,
  malePlugs: 0,
  femalePlugs: 0,
  timers: 0,
})

const STORAGE_PREFIX = 'sonl.jobmeta.v1:'
const isBrowser =
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined'

export const createDefaultJobMeta = (): JobMeta => ({
  materials: createDefaultMaterials(),
  status: 'Not started',
  finishedAt: null,
  migrated: false,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const sanitizeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

const sanitizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const sanitizeMaterialValue = (
  value: unknown,
  integer: boolean,
): number => {
  const numeric = sanitizeNumber(value)
  if (numeric === undefined) {
    return 0
  }
  const clamped = Math.max(0, numeric)
  return integer ? Math.floor(clamped) : Math.round(clamped * 100) / 100
}

export const normalizeMaterials = (value: unknown): JobMaterials => {
  if (!isRecord(value)) {
    return createDefaultMaterials()
  }

  return {
    zWireFt: sanitizeMaterialValue(
      value.zWireFt ?? value.extCords ?? value.extcords ?? value.zwireFt,
      MATERIAL_FIELD_CONFIG.zWireFt.integer,
    ),
    malePlugs: sanitizeMaterialValue(
      value.malePlugs,
      MATERIAL_FIELD_CONFIG.malePlugs.integer,
    ),
    femalePlugs: sanitizeMaterialValue(
      value.femalePlugs,
      MATERIAL_FIELD_CONFIG.femalePlugs.integer,
    ),
    timers: sanitizeMaterialValue(
      value.timers,
      MATERIAL_FIELD_CONFIG.timers.integer,
    ),
  }
}

export const normalizeJobMeta = (value: unknown): JobMeta => {
  const base = createDefaultJobMeta()
  if (!isRecord(value)) {
    return base
  }

  const meta: JobMeta = {
    ...base,
    materials: normalizeMaterials(value.materials),
  }

  if (
    value.roofType === 'single-story' ||
    value.roofType === 'two-story' ||
    value.roofType === 'steep' ||
    value.roofType === 'flat'
  ) {
    meta.roofType = value.roofType
  }

  meta.colorPattern = sanitizeString(value.colorPattern)
  meta.powerNotes = sanitizeString(value.powerNotes)
  meta.hazards = sanitizeString(value.hazards)
  meta.gateCode = sanitizeString(value.gateCode)
  meta.contactPhone = sanitizeString(value.contactPhone)
  meta.crewNotes = typeof value.crewNotes === 'string' ? value.crewNotes : undefined

  if (value.status === 'In progress' || value.status === 'Done') {
    meta.status = value.status
  }

  const finishedAt = sanitizeNumber(value.finishedAt)
  meta.finishedAt = finishedAt && Number.isFinite(finishedAt) ? finishedAt : null

  meta.migrated = value.migrated === true

  return meta
}

export function loadMeta(jobId: string): JobMeta {
  if (!isBrowser) {
    return createDefaultJobMeta()
  }

  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${jobId}`)
    if (!raw) {
      return createDefaultJobMeta()
    }

    const parsed = JSON.parse(raw) as unknown
    return normalizeJobMeta(parsed)
  } catch (error) {
    console.warn('Failed to load job meta', error)
    return createDefaultJobMeta()
  }
}

export function saveMeta(jobId: string, meta: JobMeta): void {
  if (!isBrowser) {
    return
  }

  try {
    const payload = normalizeJobMeta(meta)
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${jobId}`,
      JSON.stringify(payload),
    )
  } catch (error) {
    console.warn('Failed to save job meta', error)
  }
}
