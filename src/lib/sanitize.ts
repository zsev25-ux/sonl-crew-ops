const NULLABLE_TEXT_FIELDS = new Set(['notes', 'neighborhood', 'zip', 'client', 'address'])

const NORMALIZED_FLAG = Symbol('sanitizeForFirestore:normalized')

type SanitizeResult<T> = {
  value: T
  normalized: boolean
  remove?: boolean
}

const isTimestampLike = (value: unknown): boolean => {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { toDate?: unknown }).toDate === 'function' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const markNormalized = (value: unknown, normalized: boolean): void => {
  if (!normalized) {
    return
  }
  if (value && typeof value === 'object') {
    Object.defineProperty(value, NORMALIZED_FLAG, {
      value: true,
      enumerable: false,
      configurable: false,
    })
  }
}

const sanitizeValue = <T>(
  value: T,
  key?: string,
  parentIsArray = false,
): SanitizeResult<T> => {
  if (value === undefined) {
    if (parentIsArray || (key && NULLABLE_TEXT_FIELDS.has(key))) {
      return { value: null as T, normalized: true }
    }
    return { value, normalized: true, remove: true }
  }

  if (value === null) {
    return { value, normalized: false }
  }

  if (Array.isArray(value)) {
    let normalized = false
    const sanitized = value.map((item) => {
      const result = sanitizeValue(item, undefined, true)
      if (result.remove) {
        normalized = true
        return null as typeof item
      }
      if (result.normalized) {
        normalized = true
      }
      return result.value
    })
    return { value: sanitized as T, normalized }
  }

  if (value instanceof Date || isTimestampLike(value)) {
    return { value, normalized: false }
  }

  if (!isPlainObject(value)) {
    return { value, normalized: false }
  }

  let normalized = false
  const entries = Object.entries(value)
  const result: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of entries) {
    const child = sanitizeValue(entryValue, entryKey, false)
    if (child.remove) {
      normalized = true
      continue
    }
    if (child.normalized) {
      normalized = true
    }
    result[entryKey] = child.value
  }
  return { value: result as T, normalized }
}

export function sanitizeForFirestore<T>(value: T): T {
  const { value: sanitized, normalized } = sanitizeValue(value)
  markNormalized(sanitized, normalized)
  return sanitized
}

export const wasSanitized = (value: unknown): boolean => {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>)[NORMALIZED_FLAG])
}

export function sanitizeAndLog<T>(path: string, value: T): T {
  const sanitized = sanitizeForFirestore(value)
  if (wasSanitized(sanitized)) {
    console.debug('sanitizeForFirestore: normalized payload for', path)
  }
  return sanitized
}
