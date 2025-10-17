import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Crown, Medal } from 'lucide-react'
import type { CrewUser, LeaderboardCategoryConfig } from '@/lib/types'

const podiumVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

type LeaderboardsPageProps = {
  users: CrewUser[]
  categories: LeaderboardCategoryConfig[]
  formatValue: (category: LeaderboardCategoryConfig, value: number) => string
  getValue: (category: LeaderboardCategoryConfig, user: CrewUser) => number
  sortUsers: (category: LeaderboardCategoryConfig) => CrewUser[]
}

const pedestalStyles = [
  'from-amber-400/70 via-amber-200/20 to-amber-400/20 border border-amber-200/40',
  'from-slate-500/60 via-slate-400/20 to-slate-500/10 border border-slate-400/30',
  'from-orange-500/60 via-orange-300/20 to-orange-500/10 border border-orange-300/40',
]

function LeaderboardsPage({ users, categories, formatValue, getValue, sortUsers }: LeaderboardsPageProps) {
  const [activeKey, setActiveKey] = useState(categories[0]?.key ?? '')
  const activeCategory = useMemo(
    () => categories.find((entry) => entry.key === activeKey) ?? categories[0],
    [activeKey, categories],
  )

  const sorted = useMemo(() => (activeCategory ? sortUsers(activeCategory) : users), [activeCategory, sortUsers, users])
  const podium = sorted.slice(0, 3)
  const remainder = sorted.slice(3)

  if (!activeCategory) {
    return (
      <div className="rounded-3xl border border-white/5 bg-slate-900/70 p-6 text-slate-200">
        Configure leaderboard categories in policy to enable this view.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            onClick={() => setActiveKey(category.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              category.key === activeCategory.key
                ? 'border border-amber-300/50 bg-amber-300/20 text-amber-200 shadow-[0_12px_24px_rgba(245,158,11,0.25)]'
                : 'border border-slate-700 bg-slate-900/70 text-slate-300 hover:text-slate-100'
            }`}
          >
            {category.label}
          </button>
        ))}
      </div>

      <div className="space-y-6 rounded-3xl border border-white/5 bg-slate-900/70 p-6">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-100">{activeCategory.label}</h2>
          <p className="text-sm text-slate-400">Ranking by {activeCategory.field}</p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {podium.map((user, index) => (
            <motion.div
              key={user.id}
              variants={podiumVariants}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.35, delay: index * 0.08 }}
              className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${
                pedestalStyles[index] ?? pedestalStyles[pedestalStyles.length - 1]
              } p-5`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/70">{['Gold', 'Silver', 'Bronze'][index]}</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">{user.displayName}</h3>
                  <p className="text-xs text-white/60">{user.role}</p>
                </div>
                <CrownIcon place={index} />
              </div>
              <div className="mt-6 flex items-end justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/60">Score</p>
                  <p className="text-2xl font-semibold text-amber-200">
                    {formatValue(activeCategory, getValue(activeCategory, user))}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-white/70">
                  <span>Kudos {user.stats.kudos}</span>
                  <span>Bonuses {user.stats.bonuses}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="space-y-2">
          {remainder.map((user, index) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">{index + 4}</span>
                <div>
                  <p className="font-semibold text-white">{user.displayName}</p>
                  <p className="text-xs text-slate-400">{user.role}</p>
                </div>
              </div>
              <span className="text-sm font-semibold text-amber-300">
                {formatValue(activeCategory, getValue(activeCategory, user))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CrownIcon({ place }: { place: number }) {
  if (place === 0) {
    return <Crown className="h-7 w-7 text-amber-200" />
  }
  return <Medal className="h-6 w-6 text-white/80" />
}

export default LeaderboardsPage
