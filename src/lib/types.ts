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
  season?: SeasonPolicy
  leaderboardCategories?: LeaderboardCategoryConfig[]
  awardRules?: AwardRule[]
}

export type Role = 'admin' | 'crew' | 'dispatcher' | 'support'

export type User = {
  name: string
  role: Role
}

export type CrewStats = {
  kudos: number
  bonuses: number
  onTimePct: number
  avgInstallMins?: number
}

export type CrewSeasonStats = {
  seasonId: string
  kudos: number
  bonuses: number
  onTimePct: number
}

export type CrewUser = {
  id: string
  displayName: string
  role: 'crew' | 'admin' | 'owner'
  photoURL?: string
  bio?: string
  createdAt?: number
  updatedAt?: number
  stats: CrewStats
  season?: CrewSeasonStats
}

export type KudosDocument = {
  id: string
  imageUrl?: string
  message: string
  crewName?: string
  userRefId?: string
  reactions: Record<string, number>
  createdAt: number
  updatedAt: number
}

export type AwardDocument = {
  id: string
  userRefId: string
  seasonId: string
  key: string
  title: string
  icon?: string
  earnedAt: number
  updatedAt: number
}

export type LeaderboardCategoryConfig = {
  key: string
  label: string
  field: string
  higherIsBetter: boolean
}

export type AwardRule = {
  key: string
  title: string
  criteria: Record<string, unknown>
}

export type SeasonPolicy = {
  id: string
  start: number
  end: number
}

