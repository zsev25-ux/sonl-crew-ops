import { memo } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CrewUser } from '@/lib/types'
import { pickPrimaryStat } from '@/lib/crew'
import { useNavigate } from 'react-router-dom'

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
}

type ProfilesPageProps = {
  users: CrewUser[]
}

function ProfilesPage({ users }: ProfilesPageProps) {
  const navigate = useNavigate()
  const handleOpenProfile = (userId: string) => {
    navigate(`/crew/profiles/${encodeURIComponent(userId)}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">Crew directory</h2>
        <span className="rounded-full border border-amber-300/40 bg-amber-300/15 px-3 py-1 text-xs uppercase tracking-wide text-amber-200">
          {users.length} members
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((user, index) => (
          <motion.button
            key={user.id}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.28, delay: index * 0.03 }}
            type="button"
            onClick={() => handleOpenProfile(user.id)}
            className="group text-left"
          >
            <Card className="h-full rounded-3xl border border-white/5 bg-slate-900/70 transition hover:border-amber-300/50 hover:shadow-[0_20px_45px_rgba(245,158,11,0.2)]">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-amber-200/20 bg-amber-400/5">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={`${user.displayName} avatar`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-bold text-amber-200">
                      {user.displayName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold text-slate-100">
                    {user.displayName}
                  </CardTitle>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{user.role}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-300">
                <p className="line-clamp-2 min-h-[40px] text-slate-400">
                  {user.bio?.trim() ? user.bio : 'No bio yet — tap to add'}
                </p>
                <div className="flex items-center justify-between rounded-2xl border border-amber-200/10 bg-slate-900/70 px-4 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-amber-200/80">Season</p>
                    <p className="text-base font-semibold text-amber-200">{user.season?.seasonId ?? 'Preseason'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Primary stat</p>
                    <StatPill user={user} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

const StatPill = memo(function StatPill({ user }: { user: CrewUser }) {
  const primary = pickPrimaryStat(user.stats)
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-sm font-semibold text-amber-200">
      {primary.label}
      <span className="text-amber-100">{primary.value}</span>
    </span>
  )
})

export default memo(ProfilesPage)
