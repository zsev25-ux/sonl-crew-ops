#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { config as loadEnv } from 'dotenv'
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore/lite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(__dirname, '..')

const envLoaded = loadEnv({ path: resolve(rootDir, '.env.local') })

const requiredKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const missing = requiredKeys.filter((key) => !process.env[key] || !process.env[key]?.trim())
if (missing.length > 0) {
  console.error(
    `Missing Firebase environment variables: ${missing.join(', ')}. ` +
      'Populate .env.local (or run with env vars set) before seeding.',
  )
  process.exitCode = 1
  process.exit()
}

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const seedPolicy = {
  cutoffDateISO: '2025-12-31',
  blockedClients: ['James Jonna', 'Earl Wiggley', 'Jeff Innes'],
  maxJobsPerDay: 2,
}

const seedJobs = [
  {
    id: 1,
    date: '2025-11-28',
    crew: 'Crew Alpha',
    client: 'Byrd Supply Co.',
    scope: 'Warehouse mezzanine install',
    notes: 'Requires forklift on-site by 8am.',
    updatedAt: Date.now(),
  },
  {
    id: 2,
    date: '2025-11-28',
    crew: 'Crew Bravo',
    client: 'City of Ypsilanti',
    scope: 'Holiday lighting run-through',
    updatedAt: Date.now(),
  },
  {
    id: 3,
    date: '2025-11-30',
    crew: 'Both Crews',
    client: 'Fisher Theatre',
    scope: 'Stage rigging refit',
    notes: 'Safety briefing with venue lead before load-in.',
    updatedAt: Date.now(),
  },
]

async function main() {
  console.info('Seed starting…')
  const app = initializeApp(firebaseConfig)
  const firestore = getFirestore(app)

  await setDoc(
    doc(firestore, 'config', 'policy'),
    {
      ...seedPolicy,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  console.info('Policy seeded.')

  for (const job of seedJobs) {
    await setDoc(
      doc(firestore, 'jobs', String(job.id)),
      {
        ...job,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
    console.info(`Job ${job.id} seeded.`)
  }

  console.info('Seed complete.')
}

main().catch((error) => {
  console.error('Seed failed', error)
  process.exitCode = 1
})
