import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { liveQuery } from 'dexie'
import { Award as AwardIcon, Trophy, Users as UsersIcon, Zap } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  filterUsersBySearch,
  formatStatValue,
  getCategoryValue,
  getPolicySeasonRange,
  resolveLeaderboardCategories,
  sortUsersForCategory,
} from '@/lib/crew'
import { db, type AwardRecord, type KudosRecord, type PolicyRecord, type UserRecord } from '@/lib/db'
import type { AwardDocument, CrewUser, KudosDocument, Policy, SyncState } from '@/lib/types'
import ProfilesPage from '@/pages/crew/Profiles'
import ProfileDetailPage from '@/pages/crew/ProfileDetail'
import LeaderboardsPage from '@/pages/crew/Leaderboards'
import AwardsPage from '@/pages/crew/Awards'

const THEME = {
  panel: 'rounded-3xl border border-white/5 bg-slate-900/80 shadow-[0_20px_60px_rgba(6,10,18,0.6)] backdrop-blur-xl',
  chip: 'border border-amber-400/30 bg-amber-400/10 text-amber-200',
}

const useDexieLiveQuery = <T,>(factory: () => Promise<T>): T | undefined => {
  const [value, setValue] = useState<T>()

  useEffect(() => {
    let active = true
    const subscription = liveQuery(factory).subscribe({
      next: (result) => {
        if (active) {
          setValue(result)
        }
      },
      error: (error) => {
        console.warn('Dexie subscription error', error)
      },
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [factory])

  return value
}

const mapUserRecord = (record: UserRecord): CrewUser => {
  const stats = record.stats && typeof record.stats === 'object' ? record.stats : {}
  const season = record.season && typeof record.season === 'object' ? record.season : undefined
  return {
    id: record.id,
    displayName: record.displayName,
    role: record.role ?? 'crew',
    bio: record.bio,
    photoURL: record.photoURL,
    stats: {
      kudos: Number((stats as Record<string, unknown>).kudos ?? 0),
      bonuses: Number((stats as Record<string, unknown>).bonuses ?? 0),
      onTimePct: Number((stats as Record<string, unknown>).onTimePct ?? 0),
      avgInstallMins: (stats as Record<string, unknown>).avgInstallMins as number | undefined,
    },
    season: season
      ? {
          seasonId: String((season as Record<string, unknown>).seasonId ?? 'season'),
          kudos: Number((season as Record<string, unknown>).kudos ?? 0),
          bonuses: Number((season as Record<string, unknown>).bonuses ?? 0),
          onTimePct: Number((season as Record<string, unknown>).onTimePct ?? 0),
        }
      : undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const mapKudosRecord = (record: KudosRecord): KudosDocument => ({
  id: record.id,
  crewName: record.crewName,
  imageUrl: record.imageUrl,
  message: record.message,
  userRefId: undefined,
  reactions: record.reactions ?? {},
  createdAt: record.timestamp,
  updatedAt: record.updatedAt,
})

const mapAwardRecord = (record: AwardRecord): AwardDocument => ({
  id: record.id,
  userRefId: record.userRefId,
  seasonId: record.seasonId,
  key: record.key,
  title: record.title,
  icon: record.icon,
  earnedAt: record.earnedAt,
  updatedAt: record.updatedAt,
})

const mapPolicyRecord = (record: PolicyRecord | undefined, fallback: Policy): Policy => {
  if (!record || typeof record.value !== 'object' || !record.value) {
    return fallback
  }
  const candidate = record.value as Policy
  return {
    cutoffDateISO: candidate.cutoffDateISO ?? fallback.cutoffDateISO,
    blockedClients: candidate.blockedClients ?? fallback.blockedClients,
    maxJobsPerDay: candidate.maxJobsPerDay ?? fallback.maxJobsPerDay,
    season: candidate.season,
    leaderboardCategories: candidate.leaderboardCategories,
    awardRules: candidate.awardRules,
  }
}

type CrewShellProps = {
  syncStatus: SyncState
}

const defaultPolicy: Policy = {
  cutoffDateISO: '2025-12-31',
  blockedClients: [],
  maxJobsPerDay: 2,
}

export default function CrewShell({ syncStatus }: CrewShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const usersQuery = useCallback(() => db.users.toArray(), [])
  const kudosQuery = useCallback(() => db.kudos.toArray(), [])
  const awardsQuery = useCallback(() => db.awards.toArray(), [])
  const policyQuery = useCallback(() => db.policy.get('org'), [])
  const jobsQuery = useCallback(() => db.jobs.toArray(), [])

  const usersRaw = useDexieLiveQuery(usersQuery)
  const kudosRaw = useDexieLiveQuery(kudosQuery)
  const awardsRaw = useDexieLiveQuery(awardsQuery)
  const policyRecord = useDexieLiveQuery(policyQuery)
  const jobsRaw = useDexieLiveQuery(jobsQuery)

  const users = useMemo(() => (usersRaw ?? []).map(mapUserRecord), [usersRaw])
  const filteredUsers = useMemo(() => filterUsersBySearch(users, search), [users, search])
  const kudos = useMemo<KudosDocument[]>(() => (kudosRaw ?? []).map(mapKudosRecord), [kudosRaw])
  const awards = useMemo(() => (awardsRaw ?? []).map(mapAwardRecord), [awardsRaw])
  const policy = useMemo(() => mapPolicyRecord(policyRecord, defaultPolicy), [policyRecord])
  const jobsList = jobsRaw ?? []
  const categories = useMemo(() => resolveLeaderboardCategories(policy), [policy])

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const isDetail = location.pathname.startsWith('/crew/profiles/')

  const syncChip = (
    <span className={`${THEME.chip} flex items-center gap-2 text-xs font-semibold uppercase`}>
      <Zap className="h-3.5 w-3.5" />
      {syncStatus.status === 'pushing'
        ? 'Syncing'
        : syncStatus.status === 'error'
          ? 'Sync issue'
          : 'Synced'}
      {syncStatus.queued > 0 && <span className="ml-1 text-amber-200/80">{syncStatus.queued}</span>}
    </span>
  )

  const shellTabs: { key: string; label: string; to: string; icon: React.ReactNode }[] = [
    { key: 'profiles', label: 'Profiles', to: '/crew/profiles', icon: <UsersIcon className="h-4 w-4" /> },
    { key: 'leaderboards', label: 'Leaderboards', to: '/crew/leaderboards', icon: <Trophy className="h-4 w-4" /> },
    { key: 'awards', label: 'Awards', to: '/crew/awards', icon: <AwardIcon className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-6 pb-24">
      <Card className={THEME.panel}>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-100">Crew Control</h1>
              <p className="text-sm text-slate-400">Season overview · {getPolicySeasonRange(policy)}</p>
            </div>
            {syncChip}
          </div>
          {!isDetail && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-2">
                {shellTabs.map((tab) => (
                  <NavLink
                    key={tab.key}
                    to={tab.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        isActive
                          ? 'bg-amber-400/20 text-amber-200 shadow-[0_8px_16px_rgba(245,158,11,0.35)]'
                          : 'bg-slate-900/60 text-slate-300 hover:text-slate-100'
                      }`
                    }
                  >
                    {tab.icon}
                    {tab.label}
                  </NavLink>
                ))}
              </div>
              <div className="w-full max-w-sm">
                <Input
                  value={search}
                  onChange={(event) => handleSearch(event.target.value)}
                  placeholder="Search crew by name or role"
                  className="h-11 rounded-full border-slate-700 bg-slate-950/80 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Routes>
        <Route path="/crew/profiles" element={<ProfilesPage users={filteredUsers} />} />
        <Route
          path="/crew/profiles/:userId"
          element={
            <ProfileDetailPage
              users={users}
              kudos={kudos}
              jobs={jobsList}
              onNavigateBack={() => navigate('/crew/profiles')}
            />
          }
        />
        <Route
          path="/crew/leaderboards"
          element={
            <LeaderboardsPage
              users={users}
              categories={categories}
              formatValue={(category, value) => formatStatValue(category, value)}
              getValue={(category, user) => getCategoryValue(user, category)}
              sortUsers={(category) => sortUsersForCategory(users, category)}
            />
          }
        />
        <Route
          path="/crew/awards"
          element={<AwardsPage users={users} awards={awards} policy={policy} />}
        />
        <Route path="/crew" element={<Navigate to="/crew/profiles" replace />} />
      </Routes>
    </div>
  )
}
