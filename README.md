# SONL Crew Ops – Developer Notes

This app runs entirely against IndexedDB/Dexie when Firebase credentials are absent. When Firebase keys are provided, Firestore and Storage mirror the data so the crews can roam across devices.

## Environment Variables

Copy `.env.local.example` to `.env.local` and provide your Firebase credentials. These keys are the single source of truth in development – `window.__firebase_config` overrides are no longer supported.

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
# Optional: analytics
VITE_FIREBASE_MEASUREMENT_ID=
```

Leave the values empty to stay in local-only mode. The app will silently disable cloud sync when the keys are missing or invalid.

## Firestore Rules (example)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isCrew() {
      return request.auth != null;
    }

    match /jobs/{jobId} {
      allow read, write: if isCrew();
    }

    match /config/{docId} {
      allow read, write: if isCrew();
    }

    match /kudos/{kudosId} {
      allow read, write: if isCrew();
    }

    match /users/{userId} {
      allow read, write: if isCrew();
    }

    match /jobs/{jobId}/media/{mediaId} {
      allow read, write: if isCrew();
    }
  }
}
```

## Storage Rules (example)

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /jobs/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Firestore Seed Shape

The sync engine expects the collections to contain documents that match these shapes:

```json
// jobs/{jobId}
{
  "id": 123,
  "date": "2025-12-01",
  "crew": "Crew Alpha",
  "client": "Client Name",
  "scope": "Install lights",
  "vip": false,
  "updatedAt": 1733090400000
}

// config/policy
{
  "cutoffDateISO": "2025-12-31",
  "blockedClients": ["Alice"],
  "maxJobsPerDay": 2,
  "updatedAt": 1733090400000
}
```

`updatedAt` should be set by the server (the app writes `serverTimestamp()` on every cloud mutation). The Dexie layer will ignore stale snapshots automatically.

## Offline & Cloud QA

1. Run `pnpm dev` with no `.env.local` → the badge shows Offline and all CRUD works locally.
2. Provide valid Firebase keys → add/edit jobs offline, then go online and tap **Sync now**. The queue count drops to zero once Firestore acknowledges the operations.
3. Media uploads: add a photo offline. When the device reconnects, the queue processes the `media.upload` entry and the thumbnail resolves to the remote URL.

## PWA Install & Offline Checklist

- Start the dev server (`pnpm dev`), open the app in Chrome/Edge, and wait for the install badge to appear. Tap **Install App** (or use the browser menu on iOS) and confirm it launches full screen.
- With the PWA installed, toggle airplane mode and reload—the app shell and Dexie data should still render.
- Deploy a new build, reopen the app, and verify you’re prompted to refresh (the service worker auto-updates without losing local data).
- Inspect the Application → Service Workers panel: static assets use `StaleWhileRevalidate`, Firebase Storage media uses `CacheFirst`, and outdated caches are cleaned up automatically.

## Firestore Seeding Script

Populate a Firebase project with the default jobs/policy:

```
pnpm seed:firestore
```

The script reads `.env.local` for the `VITE_FIREBASE_*` credentials. It writes to:

- `config/policy` – organization guardrails.
- `jobs/{id}` – initial jobs used by the local seed data.

Ensure anonymous auth is enabled in Firebase Auth before running the seed.
