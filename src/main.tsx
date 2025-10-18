import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

try {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('virtual:pwa-register').then(({ registerSW }) =>
    registerSW?.({
      onOfflineReady() {},
    }),
  )
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
