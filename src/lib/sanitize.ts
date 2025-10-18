import type { ZodIssue } from 'zod'

export type SanitizationReport = {
  removedPaths: string[]
  trimmedPaths: string[]
  replacedNumericPaths: string[]
  coercedValues: string[]
}

export type SafeSerializeOptions = {
  /** Optional document path for logging */
  docPath?: string
  /** When true, remove keys whose string value becomes empty after trimming */
  removeEmptyStrings?: boolean
  /** Callback invoked with the accumulated sanitization report */
  onReport?: (report: SanitizationReport) => void
}

const defaultReport = (): SanitizationReport => ({
  removedPaths: [],
  trimmedPaths: [],
  replacedNumericPaths: [],
  coercedValues: [],
})

const joinPath = (segments: (string | number)[]): string =>
  segments.reduce<string>((acc, segment) => {
    const piece =
      typeof segment === 'number'
        ? `[${segment}]`
        : String(segment).replace(/\./g, '\\.')
    if (!acc) {
      return piece
    }
    return piece.startsWith('[') ? `${acc}${piece}` : `${acc}.${piece}`
  }, '')

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const sanitizePrimitive = (
  value: unknown,
  path: (string | number)[],
  options: SafeSerializeOptions,
  report: SanitizationReport,
): unknown => {
  if (value === undefined) {
    report.removedPaths.push(joinPath(path))
    return undefined
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed !== value) {
      report.trimmedPaths.push(joinPath(path))
    }
    if (!trimmed && options.removeEmptyStrings) {
      report.removedPaths.push(joinPath(path))
      return undefined
    }
    return trimmed
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      report.replacedNumericPaths.push(joinPath(path))
      return null
    }
    return value
  }

  if (typeof value === 'boolean' || value === null) {
    return value
  }

  if (typeof value === 'bigint') {
    const coerced = Number(value)
    if (!Number.isFinite(coerced)) {
      report.replacedNumericPaths.push(joinPath(path))
      return null
    }
    report.coercedValues.push(joinPath(path))
    return coerced
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    report.removedPaths.push(joinPath(path))
    return undefined
  }

  return value
}

const sanitizeValue = (
  value: unknown,
  path: (string | number)[],
  options: SafeSerializeOptions,
  report: SanitizationReport,
): unknown => {
  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    value.forEach((item, index) => {
      const nextPath = [...path, index]
      const result = sanitizeValue(item, nextPath, options, report)
      if (result !== undefined) {
        sanitized.push(result)
      }
    })
    return sanitized
  }

  if (isPlainObject(value)) {
    const sanitized: Record<string, unknown> = {}
    Object.entries(value).forEach(([key, child]) => {
      const nextPath = [...path, key]
      const result = sanitizeValue(child, nextPath, options, report)
      if (result !== undefined) {
        sanitized[key] = result
      }
    })
    return sanitized
  }

  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isFinite(time)) {
      return value
    }
    report.replacedNumericPaths.push(joinPath(path))
    return null
  }

  return sanitizePrimitive(value, path, options, report)
}

export function safeSerialize<T>(input: T, options: SafeSerializeOptions = {}): T {
  const report = defaultReport()
  const sanitized = sanitizeValue(input, [], options, report) as T
  if (options.onReport) {
    options.onReport(report)
  }
  if (
    options.docPath &&
    (report.removedPaths.length > 0 || report.replacedNumericPaths.length > 0)
  ) {
    console.warn('[sanitize]', options.docPath, report)
  }
  return sanitized
}

export function stripUndefined<T>(input: T): T {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input === 'symbol' || typeof input === 'function') {
    return undefined as unknown as T
  }

  if (Array.isArray(input)) {
    const out: unknown[] = []
    for (const value of input) {
      if (value === undefined) {
        continue
      }
      const stripped = stripUndefined(value)
      if (stripped !== undefined) {
        out.push(stripped)
      }
    }
    return out as unknown as T
  }

  if (input instanceof Date) {
    return input
  }

  if (typeof input === 'object') {
    if (!isPlainObject(input)) {
      return input
    }

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) {
        continue
      }
      const stripped = stripUndefined(value)
      if (stripped !== undefined) {
        out[key] = stripped
      }
    }
    return out as unknown as T
  }

  return input
}

export class SanitizationError extends Error {
  constructor(message: string, public readonly issues: ZodIssue[]) {
    super(message)
    this.name = 'SanitizationError'
  }
}
