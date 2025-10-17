import type { ZodIssue } from 'zod'

const REMOVE = Symbol('sanitize.remove')

type Primitive = string | number | boolean | bigint | symbol | null | undefined

type SanitizeValue = Primitive | Date | File | Blob | Array<SanitizeValue> | Record<string, SanitizeValue>

export type SanitizeChange = {
  path: string
  from: unknown
  to: unknown
  reason: 'undefined' | 'nan' | 'infinity' | 'trim' | 'empty-string' | 'coerce'
}

export type SanitizeReport = {
  removed: string[]
  changes: SanitizeChange[]
  issues?: ZodIssue[]
}

export type SafeSerializeOptions = {
  report?: SanitizeReport
  trimStrings?: boolean
  convertSpecialNumbers?: boolean
  removeEmptyStrings?: boolean
}

type InternalOptions = Required<Omit<SafeSerializeOptions, 'report'>>

const defaultOptions: InternalOptions = {
  trimStrings: true,
  convertSpecialNumbers: true,
  removeEmptyStrings: false,
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const recordChange = (
  report: SanitizeReport | undefined,
  change: SanitizeChange,
): void => {
  if (!report) {
    return
  }
  report.changes.push(change)
}

const recordRemoval = (report: SanitizeReport | undefined, path: string): void => {
  if (!report) {
    return
  }
  report.removed.push(path)
}

const sanitize = (
  value: unknown,
  path: string[],
  options: InternalOptions,
  report: SanitizeReport | undefined,
): unknown => {
  if (value === undefined) {
    recordRemoval(report, path.join('.'))
    return REMOVE
  }

  if (value === null) {
    return null
  }

  if (Array.isArray(value)) {
    const next: unknown[] = []
    value.forEach((entry, index) => {
      const sanitized = sanitize(entry, [...path, String(index)], options, report)
      if (sanitized !== REMOVE) {
        next.push(sanitized)
      }
    })
    return next
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) && options.convertSpecialNumbers) {
      recordChange(report, {
        path: path.join('.'),
        from: value,
        to: null,
        reason: Number.isNaN(value) ? 'nan' : 'infinity',
      })
      return null
    }
    return value
  }

  if (typeof value === 'string') {
    if (!options.trimStrings) {
      return value
    }
    const trimmed = value.trim()
    if (trimmed !== value) {
      recordChange(report, { path: path.join('.'), from: value, to: trimmed, reason: 'trim' })
    }
    if (options.removeEmptyStrings && trimmed.length === 0) {
      recordRemoval(report, path.join('.'))
      return REMOVE
    }
    return trimmed
  }

  if (typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
    return value
  }

  if (value instanceof Date || value instanceof File || value instanceof Blob) {
    return value
  }

  if (!isPlainObject(value)) {
    return value
  }

  const entries = Object.entries(value)
  const next: Record<string, unknown> = {}
  for (const [key, raw] of entries) {
    const sanitized = sanitize(raw, [...path, key], options, report)
    if (sanitized !== REMOVE) {
      next[key] = sanitized
    }
  }
  return next
}

export function safeSerialize<T>(value: T, providedOptions: SafeSerializeOptions = {}): T {
  const report = providedOptions.report
    ? providedOptions.report
    : { removed: [], changes: [], issues: [] }
  const options: InternalOptions = {
    ...defaultOptions,
    ...providedOptions,
  }
  // ensure report arrays exist when user passed object without defaults
  if (providedOptions.report) {
    providedOptions.report.removed = providedOptions.report.removed ?? []
    providedOptions.report.changes = providedOptions.report.changes ?? []
    providedOptions.report.issues = providedOptions.report.issues ?? []
  }
  const sanitized = sanitize(value as unknown, [], options, report)
  return sanitized as T
}

export function stripUndefined<T>(value: T, report?: SanitizeReport): T {
  const options: SafeSerializeOptions = {
    trimStrings: false,
    convertSpecialNumbers: false,
    removeEmptyStrings: false,
    report,
  }
  return safeSerialize(value, options)
}
