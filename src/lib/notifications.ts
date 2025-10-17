export type ToastTone = 'info' | 'warning' | 'error'

export type ToastPayload = {
  id: string
  message: string
  tone: ToastTone
}

let toastListener: ((toast: ToastPayload) => void) | null = null

export const registerToastListener = (listener: (toast: ToastPayload) => void): (() => void) => {
  toastListener = listener
  return () => {
    if (toastListener === listener) {
      toastListener = null
    }
  }
}

export const pushToast = (message: string, tone: ToastTone = 'info'): void => {
  if (!toastListener) {
    return
  }
  toastListener({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, message, tone })
}
