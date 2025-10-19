import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'

import { cloudEnabled, db as firestoreDb } from '@/lib/firebase'
import type { Award, Kudos, Role, User } from '@/lib/types'

interface RankedCrewMember {
  userId: string
  profile: User
  kudosCount: number
  awardsCount: number
  score: number
  rankTitle: string
}

const getRankTitle = (score: number): string => {
  if (score >= 150) {
    return 'Head Nutcracker'
  }
  if (score >= 51) {
    return 'Reindeer'
  }
  return 'Elf'
}

const toUser = (doc: { id: string; data: () => unknown }): [string, User] | null => {
  const raw = doc.data() as Partial<User> & { role?: Role }
  if (!raw || typeof raw.name !== 'string') {
    return null
  }
  const role: Role = (raw.role ?? 'crew') as Role
  return [doc.id, { name: raw.name, role }]
}

const toKudos = (doc: { id: string; data: () => unknown }): Kudos | null => {
  const raw = doc.data() as Partial<Kudos> & { targetUserId?: unknown; createdAt?: unknown }
  if (!raw || typeof raw.targetUserId !== 'string') {
    return null
  }
  let createdAt = new Date().toISOString()
  const source = raw.createdAt as { toDate?: () => Date } | string | undefined
  if (typeof source === 'string') {
    createdAt = source
  } else if (source && typeof source.toDate === 'function') {
    createdAt = source.toDate().toISOString()
  }
  return {
    id: doc.id,
    targetUserId: raw.targetUserId,
    fromUserId: typeof raw.fromUserId === 'string' ? raw.fromUserId : 'unknown',
    message: typeof raw.message === 'string' ? raw.message : undefined,
    createdAt,
  }
}

const toAward = (doc: { id: string; data: () => unknown }): Award | null => {
  const raw = doc.data() as Partial<Award> & { userId?: unknown; awardedAt?: unknown }
  if (!raw || typeof raw.userId !== 'string') {
    return null
  }
  let awardedAt = new Date().toISOString()
  const source = raw.awardedAt as { toDate?: () => Date } | string | undefined
  if (typeof source === 'string') {
    awardedAt = source
  } else if (source && typeof source.toDate === 'function') {
    awardedAt = source.toDate().toISOString()
  }
  return {
    id: doc.id,
    userId: raw.userId,
    title: typeof raw.title === 'string' ? raw.title : 'Award',
    awardedAt,
  }
}

export default function SparkleBoard() {
  const [entries, setEntries] = useState<RankedCrewMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cloudEnabled || !firestoreDb) {
      setError('Cloud sparkle data is offline. Try again when you have a connection!')
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const [usersSnap, kudosSnap, awardsSnap] = await Promise.all([
          getDocs(collection(firestoreDb, 'users')),
          getDocs(collection(firestoreDb, 'kudos')),
          getDocs(collection(firestoreDb, 'awards')),
        ])

        if (cancelled) {
          return
        }

        const userMap = new Map<string, User>()
        usersSnap.docs.forEach((doc) => {
          const parsed = toUser(doc)
          if (parsed) {
            userMap.set(parsed[0], parsed[1])
          }
        })

        const kudosByUser = new Map<string, number>()
        kudosSnap.docs.forEach((doc) => {
          const parsed = toKudos(doc)
          if (parsed) {
            kudosByUser.set(
              parsed.targetUserId,
              (kudosByUser.get(parsed.targetUserId) ?? 0) + 1,
            )
          }
        })

        const awardsByUser = new Map<string, number>()
        awardsSnap.docs.forEach((doc) => {
          const parsed = toAward(doc)
          if (parsed) {
            awardsByUser.set(
              parsed.userId,
              (awardsByUser.get(parsed.userId) ?? 0) + 1,
            )
          }
        })

        const ranked = Array.from(userMap.entries()).map(([userId, profile]) => {
          const kudosCount = kudosByUser.get(userId) ?? 0
          const awardsCount = awardsByUser.get(userId) ?? 0
          const score = kudosCount * 5 + awardsCount * 20
          return {
            userId,
            profile,
            kudosCount,
            awardsCount,
            score,
            rankTitle: getRankTitle(score),
          }
        })

        ranked.sort((a, b) => b.score - a.score)
        setEntries(ranked)
        setError(null)
      } catch (err) {
        console.error('Unable to load sparkle board', err)
        setError('The sparkle board elves are busy. Please try again soon!')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const highlight = useMemo(() => entries[0], [entries])

  return (
    <div className="space-y-8 py-8">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-wide text-amber-300 drop-shadow-[0_0_18px_rgba(253,224,71,0.35)]">
          Sparkle Board
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Celebrate the crews sprinkling the most cheer across Nutcracker Nation.
        </p>
      </header>

      {highlight ? (
        <section className="mx-auto max-w-xl rounded-3xl border border-amber-300/30 bg-amber-400/10 p-6 shadow-[0_0_35px_rgba(245,158,11,0.25)]">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Top Performer</p>
          <h2 className="mt-2 text-2xl font-semibold text-amber-100">{highlight.profile.name}</h2>
          <p className="mt-1 text-sm text-amber-100/80">
            {highlight.rankTitle} • {highlight.score} sparkle points
          </p>
        </section>
      ) : null}

      {loading ? (
        <p className="text-center text-sm text-slate-400">Gathering sparkle dust…</p>
      ) : null}

      {error ? (
        <p className="text-center text-sm text-rose-300">{error}</p>
      ) : null}

      {!loading && !error ? (
        <ol className="space-y-4">
          {entries.map((entry, index) => (
            <li
              key={entry.userId}
              className="flex items-center justify-between rounded-2xl border border-slate-800/70 bg-slate-900/70 px-5 py-4 shadow-lg shadow-slate-950/30"
            >
              <div>
                <p className="text-lg font-semibold text-slate-100">
                  #{index + 1} {entry.profile.name}
                </p>
                <p className="text-xs uppercase tracking-[0.25em] text-amber-200/70">
                  {entry.rankTitle}
                </p>
              </div>
              <div className="text-right text-sm text-slate-300">
                <p>
                  <span className="font-semibold text-emerald-300">{entry.score}</span> sparkle pts
                </p>
                <p className="text-xs text-slate-400">
                  {entry.kudosCount} kudos • {entry.awardsCount} awards
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <p className="text-center text-sm text-slate-400">
          No sparkle stats yet—time to light up the scoreboard!
        </p>
      ) : null}
    </div>
  )
}
