import { z } from 'zod'
import { normalizeJobMeta } from '@/lib/jobmeta'
import type { Job } from '@/lib/types'
import { safeSerialize, type SanitizationReport } from '@/lib/sanitize'

export type JobSchemaContext = {
  warnings: string[]
}

const hasToMillis = (value: unknown): value is { toMillis: () => number } =>
  typeof value === 'object' && value !== null && typeof (value as { toMillis?: unknown }).toMillis === 'function'

const RawJobSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    date: z.union([z.string(), z.date(), z.number()]).optional(),
    crew: z.union([z.string(), z.number()]).optional(),
    client: z.union([z.string(), z.number()]).optional(),
    scope: z.union([z.string(), z.number()]).optional(),
    notes: z.union([z.string(), z.number(), z.null()]).optional(),
    address: z.union([z.string(), z.number(), z.null()]).optional(),
    neighborhood: z.union([z.string(), z.number(), z.null()]).optional(),
    zip: z.union([z.string(), z.number(), z.null()]).optional(),
    tier: z
      .union([
        z.number(),
        z.nan(),
        z.literal(Number.POSITIVE_INFINITY),
        z.literal(Number.NEGATIVE_INFINITY),
        z.string(),
        z.null(),
      ])
      .optional(),
    houseTier: z
      .union([
        z.number(),
        z.nan(),
        z.literal(Number.POSITIVE_INFINITY),
        z.literal(Number.NEGATIVE_INFINITY),
        z.string(),
        z.null(),
      ])
      .optional(),
    rehangPrice: z
      .union([
        z.number(),
        z.nan(),
        z.literal(Number.POSITIVE_INFINITY),
        z.literal(Number.NEGATIVE_INFINITY),
        z.string(),
        z.null(),
      ])
      .optional(),
    lifetimeSpend: z
      .union([
        z.number(),
        z.nan(),
        z.literal(Number.POSITIVE_INFINITY),
        z.literal(Number.NEGATIVE_INFINITY),
        z.string(),
        z.null(),
      ])
      .optional(),
    vip: z.union([z.boolean(), z.number(), z.string()]).optional(),
    bothCrews: z.union([z.boolean(), z.number(), z.string()]).optional(),
    updatedAt: z.union([z.number(), z.string(), z.date(), z.custom(hasToMillis)]).optional(),
    meta: z.unknown().optional(),
  })
  .passthrough()

export type JobSyncPayload = {
  id: number
  date: string
  crew: string
  client: string
  scope: string
  notes: string
  address: string
  neighborhood: string
  zip: string
  tier: number
  houseTier: number
  rehangPrice: number | null
  lifetimeSpend: number | null
  vip: boolean
  bothCrews: boolean
  updatedAt?: number
  meta?: Job['meta']
}

const toTrimmedString = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ''
  }
  return String(value).trim()
}

const toOptionalString = (value: unknown): string => toTrimmedString(value)

const toOptionalNumber = (
  value: unknown,
  onWarning: (message: string) => void,
  field: string,
): number | null => {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    onWarning(`${field} was reset to null`)
    return null
  }
  return numeric
}

const toTier = (value: unknown, onWarning: (message: string) => void): number => {
  if (value === undefined || value === null || value === '') {
    return 1
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    onWarning('tier defaulted to 1 due to invalid input')
    return 1
  }
  const rounded = Math.round(numeric)
  if (rounded < 1 || rounded > 5) {
    const clamped = Math.min(5, Math.max(1, rounded))
    onWarning(`tier clamped to ${clamped}`)
    return clamped
  }
  if (rounded !== numeric) {
    onWarning('tier coerced to integer')
  }
  return rounded
}

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'y'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'n'].includes(normalized)) {
      return false
    }
  }
  return Boolean(value)
}

export const JobSchema = RawJobSchema.transform((raw, ctx) => {
  const context = (ctx.context as JobSchemaContext | undefined) ?? { warnings: [] }
  const warn = (message: string) => {
    context.warnings.push(message)
  }

  let hasError = false
  const requireString = (value: unknown, field: string): string => {
    const trimmed = toTrimmedString(value)
    if (!trimmed) {
      hasError = true
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} is required`,
        path: [field],
      })
      return ''
    }
    return trimmed
  }

  const idValue = typeof raw.id === 'string' ? Number(raw.id) : raw.id
  if (!Number.isFinite(idValue)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'id is invalid', path: ['id'] })
    return z.NEVER
  }

  const date = requireString(raw.date, 'date')
  const crew = requireString(raw.crew, 'crew')
  const client = requireString(raw.client, 'client')
  const scope = requireString(raw.scope, 'scope')

  if (hasError) {
    return z.NEVER
  }

  const notes = toOptionalString(raw.notes)
  const address = toOptionalString(raw.address)
  const neighborhood = toOptionalString(raw.neighborhood)
  const zip = toOptionalString(raw.zip)
  const tier = toTier(raw.tier ?? raw.houseTier, warn)
  const rehangPrice = toOptionalNumber(raw.rehangPrice, warn, 'rehangPrice')
  const lifetimeSpend = toOptionalNumber(raw.lifetimeSpend, warn, 'lifetimeSpend')
  const vip = toBoolean(raw.vip)
  const bothCrews = crew === 'Both Crews' || toBoolean(raw.bothCrews)
  const updatedAtValue = (() => {
    if (raw.updatedAt == null) {
      return undefined
    }
    if (typeof raw.updatedAt === 'number') {
      return Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined
    }
    if (typeof raw.updatedAt === 'string') {
      const parsed = Date.parse(raw.updatedAt)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    if (raw.updatedAt instanceof Date) {
      return Number.isFinite(raw.updatedAt.getTime()) ? raw.updatedAt.getTime() : undefined
    }
    if (hasToMillis(raw.updatedAt)) {
      try {
        const millis = raw.updatedAt.toMillis()
        return Number.isFinite(millis) ? millis : undefined
      } catch {
        return undefined
      }
    }
    return undefined
  })()

  const updatedAt = updatedAtValue

  const normalizedMeta = raw.meta
    ? normalizeJobMeta(raw.meta as Job['meta'] | undefined)
    : undefined

  const payload: JobSyncPayload = {
    id: Number(idValue),
    date,
    crew,
    client,
    scope,
    notes,
    address,
    neighborhood,
    zip,
    tier,
    houseTier: tier,
    rehangPrice,
    lifetimeSpend,
    vip,
    bothCrews,
    updatedAt,
    meta: normalizedMeta,
  }

  return payload
})

export type JobSchemaOutput = z.output<typeof JobSchema>

export type JobSanitizationResult = {
  data: JobSchemaOutput
  warnings: string[]
  report: SanitizationReport
}

export class JobValidationError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message)
    this.name = 'JobValidationError'
  }
}

const createValidationError = (error: z.ZodError, docPath?: string): JobValidationError => {
  const primary = error.issues[0]
  const detail = primary?.path?.length ? `${primary.path.join('.')}: ${primary.message}` : primary?.message
  const message = docPath
    ? `Sync failed: invalid data in "${docPath}"${detail ? ` (${detail})` : ''}`
    : detail ?? 'Job validation failed'
  return new JobValidationError(message, error.issues)
}

export const prepareJobForFirestore = (
  input: unknown,
  options: { docPath?: string } = {},
): JobSanitizationResult => {
  const warnings: string[] = []
  try {
    const parsed = JobSchema.parse(input, { context: { warnings } as JobSchemaContext })
    let report: SanitizationReport = { removedPaths: [], trimmedPaths: [], replacedNumericPaths: [], coercedValues: [] }
    const sanitized = safeSerialize(parsed, {
      docPath: options.docPath,
      onReport: (next) => {
        report = next
      },
    })
    return { data: sanitized, warnings, report }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw createValidationError(error, options.docPath)
    }
    throw error
  }
}

export const safePrepareJobForFirestore = (
  input: unknown,
  options: { docPath?: string } = {},
): { success: true; result: JobSanitizationResult } | { success: false; error: JobValidationError } => {
  try {
    const result = prepareJobForFirestore(input, options)
    return { success: true, result }
  } catch (error) {
    if (error instanceof JobValidationError) {
      return { success: false, error }
    }
    throw error
  }
}
