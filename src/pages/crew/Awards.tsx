import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import type { AwardDocument, CrewUser, Policy } from '@/lib/types'
import { computeAwardBadgeMedia, describeAwardRule, getPolicySeasonRange } from '@/lib/crew'

const badgeVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
}

type AwardsPageProps = {
  users: CrewUser[]
  awards: AwardDocument[]
  policy: Policy
}

function AwardsPage({ users, awards, policy }: AwardsPageProps) {
  const seasonRange = getPolicySeasonRange(policy)
  const [selectedAward, setSelectedAward] = useState<AwardDocument | null>(null)
  const awardRules = policy.awardRules ?? []
  const awardsByUser = useMemo(() => {
    const map = new Map<string, AwardDocument[]>()
    for (const award of awards) {
      if (!map.has(award.userRefId)) {
        map.set(award.userRefId, [])
      }
      map.get(award.userRefId)!.push(award)
    }
    return map
  }, [awards])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-slate-100">Season awards</h2>
        <p className="text-sm text-slate-400">{seasonRange}</p>
      </header>

      <div className="space-y-4 rounded-3xl border border-white/5 bg-slate-900/70 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Badges</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {awardRules.map((rule, index) => {
            const icon = computeAwardBadgeMedia(rule.key)
            const matchingAward = awards.find((entry) => entry.key === rule.key)
            const isEarned = Boolean(matchingAward)
            return (
              <motion.button
                key={rule.key}
                type="button"
                variants={badgeVariants}
                initial="hidden"
                animate="visible"
                transition={{ duration: 0.3, delay: index * 0.04 }}
                onClick={() => matchingAward && setSelectedAward(matchingAward)}
                className={`flex h-full flex-col justify-between rounded-3xl border px-4 py-5 text-left transition ${
                  isEarned
                    ? 'border-amber-300/50 bg-amber-300/15 text-amber-100 hover:border-amber-200'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <div className="flex items-center gap-3">
                  {icon ? (
                    <img src={icon} alt="Badge" className="h-12 w-12 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/80">
                      <Sparkles className="h-5 w-5 text-amber-200" />
                    </div>
                  )}
                  <div>
                    <h4 className="text-base font-semibold">{rule.title}</h4>
                    <p className="text-xs text-slate-400">{describeAwardRule(rule)}</p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-400">{isEarned ? 'Unlocked' : 'Locked'}</p>
              </motion.button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3 rounded-3xl border border-white/5 bg-slate-900/70 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Crew wall</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((user) => {
            const earned = awardsByUser.get(user.id) ?? []
            return (
              <div key={user.id} className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{user.displayName}</p>
                    <p className="text-xs text-slate-400">{user.role}</p>
                  </div>
                  <span className="rounded-full border border-amber-300/30 bg-amber-300/15 px-2 py-1 text-xs text-amber-200">
                    {earned.length} badge{earned.length === 1 ? '' : 's'}
                  </span>
                </div>
                {earned.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">No awards yet this season.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-xs text-slate-300">
                    {earned.map((award) => (
                      <li key={award.id} className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2">
                        <p className="font-semibold text-amber-100">{award.title}</p>
                        <p className="text-[10px] uppercase tracking-wide text-amber-200/70">
                          {new Date(award.earnedAt).toLocaleDateString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {selectedAward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur" role="dialog">
          <div className="relative w-full max-w-md rounded-3xl border border-amber-300/40 bg-slate-900/90 p-6 text-slate-200">
            <button
              type="button"
              className="absolute right-4 top-4 text-sm text-slate-400"
              onClick={() => setSelectedAward(null)}
            >
              Close
            </button>
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-amber-200">{selectedAward.title}</h3>
              <p className="text-sm text-slate-300">
                Earned {new Date(selectedAward.earnedAt).toLocaleDateString()} by{' '}
                {users.find((entry) => entry.id === selectedAward.userRefId)?.displayName ?? 'Crew'}
              </p>
              <p className="text-xs text-slate-400">
                {describeAwardRule(
                  awardRules.find((rule) => rule.key === selectedAward.key) ?? { key: selectedAward.key, title: selectedAward.title, criteria: {} },
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AwardsPage
