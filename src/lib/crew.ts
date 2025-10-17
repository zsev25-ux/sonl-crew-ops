import type {
  AwardDocument,
  AwardRule,
  CrewSeasonStats,
  CrewStats,
  CrewUser,
  KudosDocument,
  LeaderboardCategoryConfig,
  Policy,
} from '@/lib/types'

const FALLBACK_CATEGORIES: LeaderboardCategoryConfig[] = [
  {
    key: 'bonuses',
    label: 'Bonus Kings',
    field: 'stats.bonuses',
    higherIsBetter: true,
  },
  {
    key: 'kudos',
    label: 'Quality Captains',
    field: 'stats.kudos',
    higherIsBetter: true,
  },
  {
    key: 'speed',
    label: 'Speed Demons',
    field: 'stats.onTimePct',
    higherIsBetter: true,
  },
]

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const getNestedValue = (source: Record<string, unknown>, path: string): unknown => {
  const segments = path.split('.')
  let current: unknown = source
  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export const resolveLeaderboardCategories = (
  policy?: Policy | null,
): LeaderboardCategoryConfig[] => {
  if (!policy?.leaderboardCategories || policy.leaderboardCategories.length === 0) {
    return FALLBACK_CATEGORIES
  }
  return policy.leaderboardCategories
}

export const getCategoryValue = (
  user: CrewUser,
  category: LeaderboardCategoryConfig,
): number => {
  const source: Record<string, unknown> = {
    stats: user.stats,
    season: user.season,
  }
  const raw = getNestedValue(source, category.field)
  return toNumber(raw)
}

export const formatStatValue = (
  category: LeaderboardCategoryConfig,
  value: number,
): string => {
  if (category.field.includes('Pct')) {
    return `${Math.round(value)}%`
  }
  if (Number.isInteger(value)) {
    return value.toString()
  }
  return value.toFixed(1)
}

export const sortUsersForCategory = (
  users: CrewUser[],
  category: LeaderboardCategoryConfig,
): CrewUser[] => {
  const sorted = [...users]
  sorted.sort((a, b) => {
    const aValue = getCategoryValue(a, category)
    const bValue = getCategoryValue(b, category)
    const delta = bValue - aValue
    return category.higherIsBetter ? delta : -delta
  })
  return sorted
}

export type LeaderboardDelta = {
  userId: string
  value: number
}

export const findDeltaForUser = (
  userId: string,
  deltas: LeaderboardDelta[] | undefined,
): number | null => {
  if (!deltas || deltas.length === 0) {
    return null
  }
  const entry = deltas.find((delta) => delta.userId === userId)
  return entry ? entry.value : null
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const buildDefaultStats = (): CrewStats => ({
  kudos: 0,
  bonuses: 0,
  onTimePct: 0,
})

export const buildSeasonStats = (overrides: Partial<CrewSeasonStats> = {}): CrewSeasonStats => ({
  seasonId: overrides.seasonId ?? 'preseason',
  kudos: overrides.kudos ?? 0,
  bonuses: overrides.bonuses ?? 0,
  onTimePct: overrides.onTimePct ?? 0,
})

export const mergeCrewUser = (
  base: Partial<CrewUser>,
  updates: Partial<CrewUser>,
): CrewUser => {
  return {
    id: updates.id ?? base.id ?? 'unknown',
    displayName: updates.displayName ?? base.displayName ?? 'Crew Member',
    role: updates.role ?? base.role ?? 'crew',
    bio: updates.bio ?? base.bio,
    photoURL: updates.photoURL ?? base.photoURL,
    stats: { ...buildDefaultStats(), ...(base.stats ?? {}), ...(updates.stats ?? {}) },
    season: updates.season ?? base.season,
    createdAt: updates.createdAt ?? base.createdAt,
    updatedAt: updates.updatedAt ?? base.updatedAt,
  }
}

export const normalizeAwardDocument = (record: AwardDocument): AwardDocument => ({
  ...record,
  earnedAt: toNumber(record.earnedAt),
  updatedAt: toNumber(record.updatedAt),
})

export const normalizeKudosDocument = (record: KudosDocument): KudosDocument => ({
  ...record,
  createdAt: toNumber(record.createdAt),
  updatedAt: toNumber(record.updatedAt),
})

export const canUnlockAward = (
  user: CrewUser,
  rule: AwardRule,
  seasonAwards: AwardDocument[],
): boolean => {
  const alreadyEarned = seasonAwards.some(
    (award) => award.userRefId === user.id && award.key === rule.key && award.seasonId === user.season?.seasonId,
  )
  if (alreadyEarned) {
    return false
  }
  const criteria = rule.criteria ?? {}
  const season = user.season ?? buildSeasonStats()
  const total = user.stats

  for (const [key, requirement] of Object.entries(criteria)) {
    if (requirement === undefined || requirement === null) {
      continue
    }
    const requirementNumber = toNumber(requirement)
    switch (key) {
      case 'missedJobs': {
        if (requirementNumber !== 0) {
          continue
        }
        break
      }
      case 'minSeasonDays': {
        // For offline mode we cannot compute days worked, assume satisfied if season exists
        if (!season.seasonId) {
          return false
        }
        break
      }
      case 'bonusesGte': {
        if (season.bonuses < requirementNumber && total.bonuses < requirementNumber) {
          return false
        }
        break
      }
      case 'kudosGte': {
        if (season.kudos < requirementNumber && total.kudos < requirementNumber) {
          return false
        }
        break
      }
      default:
        break
    }
  }
  return true
}

export type AwardUnlock = {
  userId: string
  ruleKey: string
  seasonId: string
}

export const buildAwardUnlockId = (payload: AwardUnlock): string =>
  `${payload.userId}:${payload.ruleKey}:${payload.seasonId}`

export async function createThumbnailFromFile(
  file: File,
  targetSize = 256,
): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const scale = targetSize / Math.max(bitmap.width, bitmap.height)
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create thumbnail context')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result)
      } else {
        reject(new Error('Failed to generate avatar thumbnail'))
      }
    }, 'image/jpeg', 0.92)
  })
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  return { blob, dataUrl }
}

export const getSeasonLabel = (season?: CrewSeasonStats | null): string => {
  if (!season?.seasonId) {
    return 'Off Season'
  }
  return season.seasonId
}

export const getPolicySeasonRange = (policy?: Policy | null): string => {
  if (!policy?.season) {
    return 'Season TBD'
  }
  const start = new Date(policy.season.start)
  const end = new Date(policy.season.end)
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

export const filterUsersBySearch = (users: CrewUser[], query: string): CrewUser[] => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return users
  }
  return users.filter((user) =>
    user.displayName.toLowerCase().includes(normalized) || user.role.toLowerCase().includes(normalized),
  )
}

export const pickPrimaryStat = (stats: CrewStats): { label: string; value: string } => {
  if (stats.kudos >= stats.bonuses && stats.kudos >= stats.onTimePct) {
    return { label: 'Kudos', value: String(stats.kudos) }
  }
  if (stats.bonuses >= stats.onTimePct) {
    return { label: 'Bonuses', value: String(stats.bonuses) }
  }
  return { label: 'On-Time', value: `${Math.round(stats.onTimePct)}%` }
}

export const computeAwardBadgeMedia = (key: string): string | undefined => {
  if (key === 'upperdecky_whore') {
    return '/zyn.jpg'
  }
  if (key === 'dab_pen_chronicle') {
    return '/Remove background project.png'
  }
  return undefined
}

export const describeAwardRule = (rule: AwardRule): string => {
  const parts: string[] = []
  for (const [key, value] of Object.entries(rule.criteria ?? {})) {
    if (value === undefined || value === null) {
      continue
    }
    switch (key) {
      case 'bonusesGte':
        parts.push(`Earn ${value} bonuses`)
        break
      case 'kudosGte':
        parts.push(`Collect ${value} kudos`)
        break
      case 'minSeasonDays':
        parts.push(`Active ${value} days this season`)
        break
      default:
        break
    }
  }
  if (parts.length === 0) {
    return 'Stay awesome and keep the streak alive.'
  }
  return parts.join(' · ')
}
