import { z } from 'zod'
import type { ZodIssue } from 'zod'
import { normalizeJobMeta } from '@/lib/jobmeta'
import type { Job } from '@/lib/types'
import type { SanitizeChange } from '@/lib/sanitize'

export type NormalizedJob = Job & {
  notes: string
  address: string
  neighborhood: string
  zip: string
  houseTier: number
  rehangPrice: number
  lifetimeSpend: number
  vip: boolean
  bothCrews: boolean
  updatedAt: number
}

export type JobNormalizationResult = {
  job: NormalizedJob
  changes: SanitizeChange[]
  warnings: string[]
}

export class JobValidationError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message)
    this.name = 'JobValidationError'
  }
}

const RawJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  date: z.coerce.string().min(1, 'date is required'),
  crew: z.coerce.string().min(1, 'crew is required'),
  client: z.coerce.string().min(1, 'client is required'),
  scope: z.coerce.string().min(1, 'scope is required'),
  notes: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional(),
  address: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional(),
  neighborhood: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional(),
  zip: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional(),
  houseTier: z
    .union([
      z.number(),
      z.string(),
      z.null(),
      z.undefined(),
      z.nan(),
      z.literal(Number.POSITIVE_INFINITY),
      z.literal(Number.NEGATIVE_INFINITY),
    ])
    .optional(),
  rehangPrice: z
    .union([
      z.number(),
      z.string(),
      z.null(),
      z.undefined(),
      z.nan(),
      z.literal(Number.POSITIVE_INFINITY),
      z.literal(Number.NEGATIVE_INFINITY),
    ])
    .optional(),
  lifetimeSpend: z
    .union([
      z.number(),
      z.string(),
      z.null(),
      z.undefined(),
      z.nan(),
      z.literal(Number.POSITIVE_INFINITY),
      z.literal(Number.NEGATIVE_INFINITY),
    ])
    .optional(),
  vip: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).optional(),
  bothCrews: z.union([z.boolean(), z.null(), z.undefined()]).optional(),
  updatedAt: z
    .union([
      z.number(),
      z.string(),
      z.date(),
      z.object({}).passthrough(),
      z.null(),
      z.undefined(),
    ])
    .optional(),
  meta: z.unknown().optional(),
})

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const createIssue = (path: (string | number)[], message: string): ZodIssue => ({
  code: z.ZodIssueCode.custom,
  path,
  message,
})

const toTrimmedString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

const clampTier = (value: number | null, warnings: string[], changes: SanitizeChange[], path: string): number => {
  if (value === null) {
    warnings.push('houseTier missing; defaulted to 1')
    return 1
  }
  const int = Math.round(value)
  if (!Number.isFinite(int)) {
    warnings.push('houseTier invalid; defaulted to 1')
    return 1
  }
  if (int < 1 || int > 5) {
    warnings.push(`houseTier ${int} outside 1-5; clamped to bounds`)
  }
  const clamped = Math.min(5, Math.max(1, int))
  if (clamped !== value) {
    changes.push({ path, from: value, to: clamped, reason: 'coerce' })
  }
  return clamped
}

const normalizeBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    return trimmed === 'true' || trimmed === '1' || trimmed === 'yes'
  }
  return false
}

const resolveUpdatedAt = (value: unknown, warnings: string[], changes: SanitizeChange[]): number => {
  const fallback = Date.now()
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value
    }
    warnings.push('updatedAt not finite; replaced with Date.now()')
    changes.push({ path: 'updatedAt', from: value, to: fallback, reason: 'coerce' })
    return fallback
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
    const date = Date.parse(value)
    if (!Number.isNaN(date)) {
      return date
    }
    warnings.push('updatedAt string unparsable; replaced with Date.now()')
    changes.push({ path: 'updatedAt', from: value, to: fallback, reason: 'coerce' })
    return fallback
  }
  if (typeof value === 'object' && value && 'toMillis' in value && typeof value.toMillis === 'function') {
    const millis = value.toMillis()
    if (Number.isFinite(millis)) {
      return millis
    }
  }
  warnings.push('updatedAt invalid; replaced with Date.now()')
  changes.push({ path: 'updatedAt', from: value, to: fallback, reason: 'coerce' })
  return fallback
}

const captureStringChange = (
  path: string,
  previous: unknown,
  next: string,
  changes: SanitizeChange[],
): void => {
  const prev = previous === undefined || previous === null ? '' : String(previous)
  if (prev !== next) {
    changes.push({ path, from: previous, to: next, reason: 'trim' })
  }
}

const captureNumericChange = (
  path: string,
  previous: unknown,
  next: number,
  changes: SanitizeChange[],
): void => {
  if (previous === undefined || previous === null) {
    return
  }
  const previousNumber = toNumber(previous)
  if (previousNumber === null || previousNumber !== next) {
    changes.push({ path, from: previous, to: next, reason: 'coerce' })
  }
}

export const JobSchema = RawJobSchema.transform((raw) => {
  const changes: SanitizeChange[] = []
  const warnings: string[] = []

  const idNumber = toNumber(raw.id)
  if (idNumber === null) {
    throw new JobValidationError('Job id is invalid', [createIssue(['id'], 'Job id must be a finite number')])
  }
  const jobId = Math.round(idNumber)
  if (jobId !== idNumber) {
    changes.push({ path: 'id', from: raw.id, to: jobId, reason: 'coerce' })
  }

  const date = toTrimmedString(raw.date)
  const crew = toTrimmedString(raw.crew)
  const client = toTrimmedString(raw.client)
  const scope = toTrimmedString(raw.scope)

  if (!date || !crew || !client || !scope) {
    const issues: ZodIssue[] = []
    if (!date) {
      issues.push(createIssue(['date'], 'date is required'))
    }
    if (!crew) {
      issues.push(createIssue(['crew'], 'crew is required'))
    }
    if (!client) {
      issues.push(createIssue(['client'], 'client is required'))
    }
    if (!scope) {
      issues.push(createIssue(['scope'], 'scope is required'))
    }
    throw new JobValidationError('Required job fields are empty', issues)
  }

  const notes = toTrimmedString(raw.notes)
  captureStringChange('notes', raw.notes, notes, changes)
  const address = toTrimmedString(raw.address)
  captureStringChange('address', raw.address, address, changes)
  const neighborhood = toTrimmedString(raw.neighborhood)
  captureStringChange('neighborhood', raw.neighborhood, neighborhood, changes)
  const zip = toTrimmedString(raw.zip)
  captureStringChange('zip', raw.zip, zip, changes)

  const tierNumber = clampTier(toNumber(raw.houseTier), warnings, changes, 'houseTier')
  const rehang = toNumber(raw.rehangPrice) ?? 0
  captureNumericChange('rehangPrice', raw.rehangPrice, rehang, changes)
  const spend = toNumber(raw.lifetimeSpend) ?? 0
  captureNumericChange('lifetimeSpend', raw.lifetimeSpend, spend, changes)

  const vip = normalizeBoolean(raw.vip)
  if (raw.vip !== undefined && raw.vip !== vip) {
    changes.push({ path: 'vip', from: raw.vip, to: vip, reason: 'coerce' })
  }

  const bothCrews = raw.bothCrews === true || crew === 'Both Crews'
  if (raw.bothCrews !== undefined && raw.bothCrews !== bothCrews) {
    changes.push({ path: 'bothCrews', from: raw.bothCrews, to: bothCrews, reason: 'coerce' })
  }

  const updatedAt = resolveUpdatedAt(raw.updatedAt, warnings, changes)

  const job: NormalizedJob = {
    id: jobId,
    date,
    crew,
    client,
    scope,
    notes,
    address,
    neighborhood,
    zip,
    houseTier: tierNumber,
    rehangPrice: rehang,
    lifetimeSpend: spend,
    vip,
    bothCrews,
    updatedAt,
    meta: raw.meta ? normalizeJobMeta(raw.meta) : undefined,
  }

  return { job, changes, warnings }
})

export const parseJob = (input: unknown): JobNormalizationResult => {
  const result = JobSchema.safeParse(input)
  if (!result.success) {
    throw new JobValidationError('Job payload failed validation', result.error.issues)
  }
  return result.data
}

export const normalizeJob = (input: Job): NormalizedJob => parseJob(input).job
