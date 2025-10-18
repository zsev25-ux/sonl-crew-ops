import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import Profiles from './pages/crew/Profiles'
import ProfileDetail from './pages/crew/ProfileDetail'
import Leaderboards from './pages/crew/Leaderboards'
import Awards from './pages/crew/Awards'

const router = createBrowserRouter([
  { path: '/crew/profiles', element: <Profiles /> },
  { path: '/crew/profiles/:userId', element: <ProfileDetail /> },
  { path: '/crew/leaderboards', element: <Leaderboards /> },
  { path: '/crew/awards', element: <Awards /> },
  { path: '/*', element: <App /> },
])

if ('serviceWorker' in navigator) {
  try {
    registerSW()
  } catch (error) {
    console.error('Failed to register service worker', error)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
