import type { Job } from '@/lib/types'
import { Lightbulb } from 'lucide-react'

export interface RouteProgressDisplayProps {
  jobs: Job[]
  completedJobIds: string[]
}

export function RouteProgressDisplay({ jobs, completedJobIds }: RouteProgressDisplayProps) {
  const completedSet = new Set(completedJobIds.map((id) => id.trim()))

  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-[0.6rem] top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-emerald-400/70 via-amber-400/40 to-transparent"
        aria-hidden="true"
      />
      <ol className="relative space-y-6 border-l border-slate-800/70 pl-6">
        {jobs.map((job, index) => {
          const jobId = String(job.id)
          const isComplete = completedSet.has(jobId)
          return (
            <li key={jobId} className="relative flex items-start gap-4">
              <span className="absolute -left-[2.05rem] flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-800 bg-slate-900 shadow-[0_4px_16px_rgba(15,23,42,0.45)]">
                <Lightbulb
                  aria-hidden="true"
                  className={`h-5 w-5 ${
                    isComplete
                      ? 'text-emerald-400 drop-shadow-[0_0_12px_rgba(74,222,128,0.65)]'
                      : 'text-slate-500'
                  }`}
                />
              </span>
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 px-4 py-3 shadow-inner shadow-black/20">
                <p className="text-sm font-semibold text-slate-100">
                  {index + 1}. {job.client}
                </p>
                {job.address ? <p className="text-xs text-slate-400">{job.address}</p> : null}
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-amber-200/70">
                  {isComplete ? 'Complete' : 'Awaiting Magic'}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default RouteProgressDisplay
