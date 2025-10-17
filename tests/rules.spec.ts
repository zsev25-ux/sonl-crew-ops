import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isCrew() {
      return request.auth != null;
    }

    match /jobs/{jobId} {
      allow read, write: if isCrew();

      match /media/{mediaId} {
        allow read, write: if isCrew();
      }
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
  }
}`;

const STORAGE_RULES = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /jobs/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'sonl-crew-ops-test',
    firestore: {
      rules: FIRESTORE_RULES,
    },
    storage: {
      rules: STORAGE_RULES,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await Promise.all([
    testEnv.clearFirestore(),
    testEnv.clearStorage(),
  ]);
});

describe('Firestore security rules for jobs', () => {
  it('allows authenticated users to read and write job documents', async () => {
    const authedDb = testEnv.authenticatedContext('crew-user').firestore();
    const jobRef = doc(authedDb, 'jobs/job123');

    await assertSucceeds(setDoc(jobRef, { name: 'Test Job', updatedAt: 0 }));
    await assertSucceeds(getDoc(jobRef));
  });

  it('denies unauthenticated users from reading or writing job documents', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'jobs/job123'), { name: 'Seed Job', updatedAt: 0 });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const jobRef = doc(unauthDb, 'jobs/job123');

    await assertFails(getDoc(jobRef));
    await assertFails(setDoc(jobRef, { name: 'Should Fail', updatedAt: 1 }));
  });

  it('restricts media subcollection access to authenticated users', async () => {
    const authedDb = testEnv.authenticatedContext('crew-user').firestore();
    const mediaRef = doc(authedDb, 'jobs/job123/media/media456');

    await assertSucceeds(setDoc(mediaRef, { path: 'media456.jpg', updatedAt: 0 }));
    await assertSucceeds(getDoc(mediaRef));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'jobs/job789/media/media000'), {
        path: 'existing.jpg',
        updatedAt: 0,
      });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const forbiddenRef = doc(unauthDb, 'jobs/job789/media/media000');

    await assertFails(getDoc(forbiddenRef));
    await assertFails(setDoc(forbiddenRef, { path: 'should-fail.jpg', updatedAt: 1 }));
  });
});

describe('Storage security rules for job media', () => {
  it('allows authenticated users to read and write job media files', async () => {
    const authedStorage = testEnv.authenticatedContext('crew-user').storage();
    const fileRef = ref(authedStorage, 'jobs/job123/media/test.txt');
    const data = new TextEncoder().encode('test-data');

    await assertSucceeds(uploadBytes(fileRef, data));
    await assertSucceeds(getBytes(fileRef));
  });

  it('denies unauthenticated users from reading or writing job media files', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminStorage = context.storage();
      const fileRef = ref(adminStorage, 'jobs/job123/media/existing.txt');
      await uploadBytes(fileRef, new TextEncoder().encode('seed'));
    });

    const unauthStorage = testEnv.unauthenticatedContext().storage();
    const fileRef = ref(unauthStorage, 'jobs/job123/media/existing.txt');
    const newData = new TextEncoder().encode('should-fail');

    await assertFails(uploadBytes(fileRef, newData));
    await assertFails(getBytes(fileRef));
  });
});
