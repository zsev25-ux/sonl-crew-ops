import type { Job } from '@/lib/types'

type FestiveStatus = 'Pending' | 'In Progress' | 'Complete' | 'Issue'

const STATUS_COLORS: Record<FestiveStatus, string> = {
  Pending: 'border-amber-400',
  'In Progress': 'border-sky-500',
  Complete: 'border-emerald-500',
  Issue: 'border-rose-500',
}

const STATUS_LABELS: Record<FestiveStatus, string> = {
  Pending: 'Pending',
  'In Progress': 'In Progress',
  Complete: 'Complete',
  Issue: 'Issue',
}

const DEFAULT_STATUS: FestiveStatus = 'Pending'

const normalizeStatus = (status: unknown): FestiveStatus => {
  if (!status) {
    return DEFAULT_STATUS
  }
  const value = String(status) as FestiveStatus
  if (value in STATUS_COLORS) {
    return value
  }
  const lowered = String(status).toLowerCase()
  if (lowered === 'not started') {
    return 'Pending'
  }
  if (lowered === 'in progress' || lowered === 'progress') {
    return 'In Progress'
  }
  if (lowered === 'done' || lowered === 'complete' || lowered === 'completed') {
    return 'Complete'
  }
  if (lowered === 'issue' || lowered === 'blocked') {
    return 'Issue'
  }
  return DEFAULT_STATUS
}

export interface FestiveJobCardProps {
  job: Job
}

export function FestiveJobCard({ job }: FestiveJobCardProps) {
  const status = normalizeStatus((job as Job & { status?: FestiveStatus }).status ?? job.meta?.status)
  const borderClass = STATUS_COLORS[status]
  return (
    <article
      className={`overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg shadow-slate-950/40 backdrop-blur ${borderClass} border-t-4`}
    >
      <div className="p-5">
        <header className="flex items-start justify-between">
          <h3 className="text-xl font-semibold text-slate-100">{job.client}</h3>
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-amber-200">
            {STATUS_LABELS[status]}
          </span>
        </header>
        {job.address ? (
          <p className="mt-2 text-sm text-slate-300">{job.address}</p>
        ) : null}
        <footer className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-amber-200/70">
          <span>{job.crew}</span>
          <span>{job.date}</span>
        </footer>
      </div>
    </article>
  )
}

export default FestiveJobCard
