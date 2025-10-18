import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import {
  Boxes,
  LayoutDashboard,
  Map as MapIcon,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'

export type NavKey = 'route' | 'board' | 'hq' | 'inventory' | 'profile'

export interface BottomNavProps {
  active: NavKey
  setActive: (key: NavKey) => void
  routeProgress?: number
  unreadKudos?: number
  pendingSync?: number
}

type NavItem = {
  key: NavKey
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { key: 'route', label: 'Today', icon: MapIcon },
  { key: 'board', label: 'Board', icon: LayoutDashboard },
  { key: 'hq', label: 'Crew HQ', icon: Users },
  { key: 'inventory', label: 'Inventory', icon: Boxes },
  { key: 'profile', label: 'Profile', icon: UserRound },
]

const clampProgress = (value: number | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

const vibrateSoft = () => {
  if (typeof navigator !== 'undefined') {
    navigator.vibrate?.(12)
  }
}

export default function BottomNav({
  active,
  setActive,
  routeProgress,
  unreadKudos,
  pendingSync,
}: BottomNavProps) {
  const safeAreaStyle = useMemo(
    () => ({ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }),
    [],
  )
  const clampedRouteProgress = clampProgress(routeProgress)
  const hqBadge = unreadKudos && unreadKudos > 0 ? unreadKudos : 0
  const profileBadge = pendingSync && pendingSync > 0 ? pendingSync : 0

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/40 backdrop-blur"
      aria-label="Primary navigation"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-black/60 via-black/0 to-transparent"
      />
      <div className="mx-auto w-full max-w-4xl px-4" style={safeAreaStyle}>
        <LayoutGroup>
          <div className="relative isolate overflow-hidden rounded-[28px] border border-white/10 bg-black/40 shadow-[0_-12px_45px_rgba(0,0,0,0.55)]">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/10 via-white/0 to-transparent opacity-20"
            />
            <div className="relative flex items-stretch justify-between">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const isActive = active === item.key
                const badgeValue =
                  item.key === 'hq' ? hqBadge : item.key === 'profile' ? profileBadge : 0
                const underlineScale =
                  item.key === 'route'
                    ? isActive
                      ? Math.max(clampedRouteProgress, 0.12)
                      : 0
                    : isActive
                      ? 1
                      : 0

                return (
                  <motion.button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      vibrateSoft()
                      setActive(item.key)
                    }}
                    className="group relative flex flex-1 min-h-[64px] flex-col items-center justify-center gap-1 py-2 px-3 text-sm font-semibold tracking-[0.18em] text-white/80 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="nav-active-glow"
                        className="pointer-events-none absolute inset-[6px] rounded-[22px] border border-amber-400/60 bg-amber-500/15 shadow-[0_0_30px_rgba(245,158,11,0.55)]"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    )}

                    <motion.span
                      aria-hidden
                      className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200 ${
                        isActive
                          ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.55)]'
                          : 'text-white/80 group-hover:text-white group-active:text-white'
                      }`}
                      animate={{ scale: isActive ? [1, 1.12, 1] : 1 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      style={
                        isActive
                          ? { boxShadow: 'inset 0 0 12px rgba(245, 158, 11, 0.45)' }
                          : undefined
                      }
                    >
                      <Icon className="h-5 w-5" />
                      <AnimatePresence>
                        {badgeValue > 0 && (
                          <motion.span
                            layoutId={`${item.key}-badge`}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 520, damping: 24 }}
                            className="absolute -right-1 -top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-black shadow-[0_0_16px_rgba(245,158,11,0.65)]"
                          >
                            {badgeValue > 9 ? '9+' : badgeValue}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.span>

                    <motion.span
                      className={`relative text-sm text-white ${
                        isActive
                          ? 'text-shadow-bright text-white'
                          : 'text-white/80 group-hover:text-white group-active:text-white'
                      }`}
                      animate={{ y: isActive ? -2 : 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                    >
                      {item.label}
                    </motion.span>

                    <AnimatePresence mode="wait">
                      {isActive && (
                        <motion.span
                          key={`shimmer-${item.key}-${active}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="pointer-events-none absolute inset-[4px] overflow-hidden rounded-[20px]"
                        >
                          <motion.span
                            className="absolute inset-y-0 left-[-40%] w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                            style={{ clipPath: 'polygon(0 0, 75% 0, 100% 100%, 25% 100%)' }}
                            initial={{ x: '-60%' }}
                            animate={{ x: '160%' }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                          />
                        </motion.span>
                      )}
                    </AnimatePresence>

                    <motion.span
                      className="pointer-events-none absolute bottom-1 left-1/2 h-[3px] w-2/3 -translate-x-1/2 rounded-full bg-amber-400/80 shadow-[0_0_18px_rgba(245,158,11,0.6)]"
                      style={{ originX: 0.5 }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: underlineScale }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </motion.button>
                )
              })}
            </div>
          </div>
        </LayoutGroup>
      </div>
    </nav>
  )
}
