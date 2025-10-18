# Codebase Audit Findings

## Typo Fix Task
- **Issue:** There is a duplicated UI component tree under `src/componets/...`, and the directory name is misspelled (`componets` instead of `components`). This typo makes the alias-resolved folder easy to confuse with the actual `src/components` directory and risks broken imports if tooling or contributors reference the wrong path.
- **Proposed Task:** Rename the stray `src/componets` directory (and its nested folders) to `src/components` or remove it if it is vestigial, then update any imports that rely on the misspelled path.
- **Context:** `src/componets/ui/src/components/ui/button.tsx` mirrors the real component implementation under the correctly spelled folder, demonstrating the typo duplication.【F:src/componets/ui/src/components/ui/button.tsx†L1-L22】【F:src/components/ui/button.tsx†L1-L22】

## Bug Fix Task
- **Issue:** Media uploads always take the Firebase code path whenever credentials are present, even if the device is offline. The static `mediaBackend` flag ignores connectivity and forces `saveImage`/`saveVideo` to call Firebase SDK APIs that fail without a network, preventing offline media captures from being saved locally for later sync.【F:src/lib/media.ts†L59-L66】【F:src/lib/media.ts†L400-L447】
- **Proposed Task:** Make the media backend decision dynamic (e.g., detect `navigator.onLine` or catch upload errors) so that when cloud sync is unavailable the code stores files in IndexedDB and defers Firebase uploads until connectivity returns.

## Documentation/Comment Discrepancy Task
- **Issue:** The README claims that `window.__firebase_config` overrides "are no longer supported," yet the runtime still reads from that global and prefers it over environment variables, contradicting the documentation.【F:README.md†L7-L20】【F:src/lib/firebase.ts†L20-L38】
- **Proposed Task:** Either remove the window-based fallback from `src/lib/firebase.ts` or update the README to explain that the override remains supported, keeping the docs consistent with the implementation.

## Test Improvement Task
- **Issue:** `bootstrapAppData` has explicit fallback logic for scenarios where Dexie fails to open or throws during bootstrap, but the current Vitest suite only exercises the happy paths and legacy migration. No test asserts the fallback behavior when `db.open` rejects, leaving that branch unguarded.【F:src/lib/app-data.ts†L90-L166】【F:src/lib/__tests__/app-data.test.ts†L96-L160】
- **Proposed Task:** Add a test that stubs `db.open` to throw, verifies that `bootstrapAppData` returns the provided fallback snapshot with `source: 'fallback'`, and ensures Dexie error handling remains intact.
