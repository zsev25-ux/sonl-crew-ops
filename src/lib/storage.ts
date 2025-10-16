const hasStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

export function load<T>(key: string, fallback: T): T {
  if (!hasStorage()) {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return fallback
    }

    return JSON.parse(raw) as T
  } catch (error) {
    console.warn(`Failed to load key "${key}" from storage`, error)
    return fallback
  }
}

export function save<T>(key: string, value: T): void {
  if (!hasStorage()) {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Failed to persist key "${key}" to storage`, error)
  }
}
