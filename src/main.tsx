import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { BrowserRouter } from 'react-router-dom'

try {
  void import('virtual:pwa-register').then(({ registerSW }) =>
    registerSW?.({
      onOfflineReady() {
        // noop – we surface offline-ready state elsewhere
      },
    }),
  )
} catch (error) {
  console.warn('PWA registration skipped', error)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
