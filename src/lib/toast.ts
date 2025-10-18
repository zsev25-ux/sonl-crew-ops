export type ToastVariant = 'info' | 'warning' | 'error'

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: 'bg-slate-900/90 text-slate-100 border border-slate-700/80',
  warning: 'bg-amber-500/95 text-slate-900 border border-amber-300/80',
  error: 'bg-rose-600/95 text-white border border-rose-300/70',
}

const ensureLayer = (): HTMLElement | null => {
  if (typeof document === 'undefined') {
    return null
  }
  const existing = document.getElementById('layer-toast')
  if (existing) {
    return existing
  }
  const fallback = document.createElement('div')
  fallback.id = 'layer-toast'
  fallback.className = 'pointer-events-none fixed inset-0 z-[60] flex flex-col items-center gap-2 p-4'
  document.body.appendChild(fallback)
  return fallback
}

export const showToast = (message: string, variant: ToastVariant = 'info'): void => {
  if (typeof document === 'undefined') {
    return
  }
  const layer = ensureLayer()
  if (!layer) {
    return
  }
  const container = document.createElement('div')
  container.className = `pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg transition-all duration-300 ease-out opacity-0 translate-y-2 ${
    VARIANT_CLASSES[variant]
  }`
  const text = document.createElement('div')
  text.textContent = message
  text.className = 'flex-1'
  container.appendChild(text)
  layer.appendChild(container)

  requestAnimationFrame(() => {
    container.classList.remove('opacity-0')
    container.classList.remove('translate-y-2')
    container.classList.add('opacity-100')
    container.classList.add('translate-y-0')
  })

  window.setTimeout(() => {
    container.classList.add('opacity-0')
    container.classList.add('-translate-y-2')
    window.setTimeout(() => {
      container.remove()
    }, 350)
  }, 4000)
}
