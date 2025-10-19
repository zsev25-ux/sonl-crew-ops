import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'
import type { Functions } from 'firebase/functions'

import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

type FirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

const readConfig = (): FirebaseConfig | null => {
  const env = (import.meta.env ?? {}) as ImportMetaEnv

  const fallback =
    typeof window !== 'undefined' &&
    (window as typeof window & { __firebase_config?: Record<string, unknown> })
      .__firebase_config
  const configSource =
    fallback && typeof fallback === 'object'
      ? fallback
      : {
          apiKey: env.VITE_FIREBASE_API_KEY ?? env.VITE_FB_API_KEY,
          authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? env.VITE_FB_AUTH_DOMAIN,
          projectId: env.VITE_FIREBASE_PROJECT_ID ?? env.VITE_FB_PROJECT_ID,
          storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? env.VITE_FB_STORAGE_BUCKET,
          messagingSenderId:
            env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? env.VITE_FB_MESSAGING_SENDER_ID,
          appId: env.VITE_FIREBASE_APP_ID ?? env.VITE_FB_APP_ID,
        }

  const apiKey = String(configSource.apiKey ?? '').trim()
  const authDomain = String(configSource.authDomain ?? '').trim()
  const projectId = String(configSource.projectId ?? '').trim()
  const storageBucket = String(configSource.storageBucket ?? '').trim()
  const messagingSenderId = String(configSource.messagingSenderId ?? '').trim()
  const appId = String(configSource.appId ?? '').trim()

  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !storageBucket ||
    !messagingSenderId ||
    !appId
  ) {
    return null
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  }
}

const config = readConfig()

export const cloudEnabled = Boolean(config)

let app: FirebaseApp | undefined
let authInstance: Auth | undefined
let firestoreInstance: Firestore | undefined
let storageInstance: FirebaseStorage | undefined
let functionsInstance: Functions | undefined

if (cloudEnabled && config) {
  app = initializeApp(config)
  authInstance = getAuth(app)
  firestoreInstance = getFirestore(app)
  storageInstance = getStorage(app)
  functionsInstance = getFunctions(app)
}

export const firebaseApp = app
export const auth = authInstance
export const db = firestoreInstance
export const storage = storageInstance
export const functions = functionsInstance

export const ensureAnonAuth = async (): Promise<void> => {
  if (!cloudEnabled || !authInstance) {
    return
  }

  if (!authInstance.currentUser) {
    await signInAnonymously(authInstance)
  }
}
