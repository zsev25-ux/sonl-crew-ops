import type { JobMeta } from '@/lib/jobmeta'

export type CrewOption = 'Crew Alpha' | 'Crew Bravo' | 'Both Crews'

export type JobCore = {
  date: string
  crew: string
  client: string
  scope: string
  notes?: string
  address?: string
  neighborhood?: string
  zip?: string
  houseTier?: number
  rehangPrice?: number
  lifetimeSpend?: number
  vip?: boolean
  meta?: JobMeta
}

export type Job = JobCore & {
  id: number
}

export type Policy = {
  cutoffDateISO: string
  blockedClients: string[]
  maxJobsPerDay: number
}

export type Role = 'admin' | 'crew' | 'dispatcher' | 'support'

export type User = {
  name: string
  role: Role
}
