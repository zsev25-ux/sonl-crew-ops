import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

void import('virtual:pwa-register')
  .then(({ registerSW }) =>
    registerSW?.({
      onOfflineReady: () => {
        /* noop */
      },
    }),
  )
  .catch((error) => {
    console.warn('PWA registration unavailable', error)
  })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
