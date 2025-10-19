import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ref, uploadBytesResumable } from 'firebase/storage'

import { db, type JobChecklistStateRecord } from '@/lib/db'
import type { Job } from '@/lib/types'
import { ensureAnonAuth, storage } from '@/lib/firebase'
import { showToast } from '@/lib/toast'

interface ChecklistItem {
  id: string
  label: string
  checked: boolean
}

const createItemId = (label: string, index: number): string => {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${index}-${normalized || 'item'}`
}

const parseScopeToItems = (scope: string): string[] => {
  return scope
    .split(/\r?\n|[•;]+/)
    .map((entry) => entry.replace(/^[-\s]+/, '').trim())
    .filter((entry) => entry.length > 0)
}

const mapRecordToJob = (record: unknown): Job | null => {
  if (!record || typeof record !== 'object') {
    return null
  }
  const candidate = record as Job & { updatedAt?: number; bothCrews?: boolean }
  if (typeof candidate.id !== 'number') {
    return null
  }
  return {
    id: candidate.id,
    date: candidate.date,
    crew: candidate.crew,
    client: candidate.client,
    scope: candidate.scope,
    notes: candidate.notes,
    address: candidate.address,
    neighborhood: candidate.neighborhood,
    zip: candidate.zip,
    houseTier: candidate.houseTier,
    rehangPrice: candidate.rehangPrice,
    lifetimeSpend: candidate.lifetimeSpend,
    vip: candidate.vip,
    meta: candidate.meta,
    status: candidate.status,
  }
}

export default function InstallBlueprint() {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>()
  const jobIdNumber = useMemo(() => {
    if (!jobIdParam) {
      return NaN
    }
    const parsed = Number(jobIdParam)
    return Number.isFinite(parsed) ? parsed : NaN
  }, [jobIdParam])

  const [job, setJob] = useState<Job | null>(null)
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadJob = async () => {
      if (!Number.isFinite(jobIdNumber)) {
        setError('Invalid job id. Please check the link and try again.')
        setLoading(false)
        return
      }
      try {
        const record = await db.jobs.get(jobIdNumber)
        if (cancelled) {
          return
        }
        if (!record) {
          setError('We could not find that job in the offline cache.')
          setJob(null)
          setLoading(false)
          return
        }
        const mapped = mapRecordToJob(record)
        if (!mapped) {
          setError('Job data looks a little frosty. Please resync and try again.')
          setJob(null)
        } else {
          setJob(mapped)
          setError(null)
        }
      } catch (err) {
        console.error('Unable to load job from Dexie', err)
        if (!cancelled) {
          setError('Something melted our blueprint data. Give it another go soon.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadJob()

    return () => {
      cancelled = true
    }
  }, [jobIdNumber])

  useEffect(() => {
    let cancelled = false
    const loadChecklist = async () => {
      if (!Number.isFinite(jobIdNumber)) {
        return
      }
      try {
        const existing = (await db.jobChecklistState.get(jobIdNumber)) as JobChecklistStateRecord | undefined
        if (!cancelled && existing) {
          setChecklistState(existing.items)
        }
      } catch (err) {
        console.error('Unable to load checklist state', err)
      }
    }

    void loadChecklist()

    return () => {
      cancelled = true
    }
  }, [jobIdNumber])

  const checklistItems = useMemo(() => {
    if (!job) {
      return [] as ChecklistItem[]
    }
    const parsed = parseScopeToItems(job.scope)
    return parsed.map((label, index) => {
      const id = createItemId(label, index)
      return {
        id,
        label,
        checked: checklistState[id] ?? false,
      }
    })
  }, [job, checklistState])

  const persistChecklist = useCallback(
    async (nextState: Record<string, boolean>) => {
      if (!Number.isFinite(jobIdNumber)) {
        return
      }
      try {
        await db.jobChecklistState.put({
          jobId: jobIdNumber,
          items: nextState,
          updatedAt: Date.now(),
        })
      } catch (err) {
        console.error('Unable to persist checklist', err)
        showToast('We saved your checkmark locally, but syncing will retry shortly.', 'warning')
      }
    },
    [jobIdNumber],
  )

  const toggleChecklistItem = useCallback(
    (itemId: string) => {
      setChecklistState((prev) => {
        const next = { ...prev, [itemId]: !prev[itemId] }
        void persistChecklist(next)
        return next
      })
    },
    [persistChecklist],
  )

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!Number.isFinite(jobIdNumber)) {
        showToast('We need a valid job before uploading holiday glam shots.', 'warning')
        return
      }
      const file = event.target.files?.[0]
      if (!file) {
        return
      }
      event.target.value = ''

      if (!storage) {
        setUploadError('Cloud storage is offline. Try again when you are connected.')
        return
      }

      try {
        await ensureAnonAuth()
      } catch (err) {
        console.error('Unable to authenticate before upload', err)
      }

      setUploadError(null)
      setUploadStatus('Starting upload…')
      setUploadProgress(0)

      const path = `jobs/${jobIdNumber}/media/${Date.now()}.jpg`
      const uploadRef = ref(storage, path)
      const task = uploadBytesResumable(uploadRef, file)

      task.on(
        'state_changed',
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          setUploadProgress(progress)
          setUploadStatus(`Uploading… ${progress}%`)
        },
        (error) => {
          console.error('Upload error', error)
          setUploadError('Uh oh! The upload elves stumbled. Please retry when the connection is steadier.')
          setUploadStatus(null)
        },
        () => {
          setUploadProgress(100)
          setUploadStatus('Upload complete! Your photo will sync when online.')
        },
      )
    },
    [jobIdNumber],
  )

  if (loading) {
    return <p className="py-12 text-center text-slate-300">Loading blueprint magic…</p>
  }

  if (error) {
    return <p className="py-12 text-center text-rose-300">{error}</p>
  }

  if (!job) {
    return <p className="py-12 text-center text-slate-300">No job data found.</p>
  }

  return (
    <div className="space-y-8 py-8">
      <header className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/40">
        <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Install Blueprint</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-100">{job.client}</h1>
        {job.address ? <p className="mt-1 text-sm text-slate-300">{job.address}</p> : null}
        <p className="mt-4 text-xs uppercase tracking-[0.3em] text-amber-200/70">
          {job.date} • {job.crew}
        </p>
      </header>

      <section className="rounded-3xl border border-slate-800/70 bg-slate-900/60 p-6 shadow-inner shadow-slate-950/30">
        <h2 className="text-lg font-semibold text-slate-100">Scope Checklist</h2>
        {checklistItems.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No checklist items found in this job scope.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {checklistItems.map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-4">
                <input
                  id={item.id}
                  type="checkbox"
                  className="mt-1 h-5 w-5 rounded border-amber-400/40 bg-slate-900/80 text-amber-400 focus:ring-amber-300"
                  checked={item.checked}
                  onChange={() => toggleChecklistItem(item.id)}
                />
                <label htmlFor={item.id} className="flex-1 text-sm text-slate-200">
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-slate-800/70 bg-slate-900/60 p-6 shadow-inner shadow-slate-950/30">
        <h2 className="text-lg font-semibold text-slate-100">Upload Install Photos</h2>
        <p className="mt-2 text-sm text-slate-400">
          Snap the final glow and the blueprint will sync when you head back online.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="block w-full cursor-pointer rounded-full border border-slate-700/60 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          />
          {uploadStatus ? (
            <span className="text-sm text-amber-200">{uploadStatus}</span>
          ) : null}
        </div>
        {uploadProgress !== null ? (
          <div className="mt-3 h-2 w-full rounded-full bg-slate-800/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        ) : null}
        {uploadError ? <p className="mt-2 text-sm text-rose-300">{uploadError}</p> : null}
      </section>
    </div>
  )
}
