/// <reference types="vite/client" />

declare module 'virtual:pwa-register' {
  export function registerSW(opts?: { onOfflineReady?: () => void }): void
}
