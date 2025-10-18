import { useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Boxes,
  LayoutDashboard,
  Map as MapIcon,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'

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
  ariaLabel: string
  showProgress?: boolean
  showUnread?: boolean
  showPending?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'route', label: 'Today', ariaLabel: 'Route', icon: MapIcon, showProgress: true },
  { key: 'board', label: 'Board', ariaLabel: 'Board', icon: LayoutDashboard },
  { key: 'hq', label: 'Crew HQ', ariaLabel: 'Crew HQ', icon: Users, showUnread: true },
  { key: 'inventory', label: 'Inventory', ariaLabel: 'Inventory', icon: Boxes },
  { key: 'profile', label: 'Profile', ariaLabel: 'Profile', icon: UserRound, showPending: true },
]

const clampProgress = (value: number | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  return Math.min(Math.max(value, 0), 1)
}

export function BottomNav({
  active,
  setActive,
  routeProgress,
  unreadKudos,
  pendingSync,
}: BottomNavProps) {
  const normalizedProgress = useMemo(() => clampProgress(routeProgress), [routeProgress])

  const handleSelect = useCallback(
    (key: NavKey) => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12)
      }
      setActive(key)
    },
    [setActive],
  )

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/40 backdrop-blur"
      aria-label="Primary navigation"
    >
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-t from-transparent via-black/40 to-black/60" />
        <div className="mx-auto flex max-w-3xl items-stretch gap-1 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.8rem)] pt-3">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active
            const Icon = item.icon
            const underlineWidth = item.key === 'route' ? `${Math.max(normalizedProgress, 0.12) * 100}%` : '58%'
            const showUnreadBadge = item.showUnread && (unreadKudos ?? 0) > 0
            const showPendingBadge = item.showPending && (pendingSync ?? 0) > 0

            return (
              <motion.button
                key={item.key}
                type="button"
                aria-label={item.ariaLabel}
                aria-current={isActive ? 'page' : undefined}
                className="group relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 text-white/80 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                onClick={() => handleSelect(item.key)}
                whileTap={{ scale: 0.96 }}
              >
                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      key={`${item.key}-ring`}
                      layoutId="nav-active-ring"
                      className="pointer-events-none absolute inset-0 rounded-2xl border border-amber-400/60 bg-amber-400/5 shadow-[0_0_18px_rgba(245,158,11,0.35)]"
                      initial={{ opacity: 0.4, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                    />
                  )}
                </AnimatePresence>

                <motion.div
                  className="relative flex h-10 w-10 items-center justify-center rounded-xl"
                  animate={{ scale: isActive ? [1, 1.12, 1] : 1 }}
                  transition={{ duration: 0.45, ease: 'easeOut', times: isActive ? [0, 0.42, 1] : undefined }}
                >
                  <Icon
                    aria-hidden="true"
                    className={[
                      'h-6 w-6 transition-colors transition-transform duration-200',
                      isActive
                        ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.55)] shadow-[inset_0_0_12px_rgba(245,158,11,0.35)]'
                        : 'text-white/80 group-hover:text-white group-focus-visible:text-white group-hover:scale-[1.08] group-active:scale-[0.96]',
                    ].join(' ')}
                  />

                  <AnimatePresence>
                    {isActive && (
                      <motion.span
                        key={`${item.key}-shimmer`}
                        className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <motion.span
                          className="absolute -left-1/3 top-0 h-full w-2/3 skew-x-12 bg-gradient-to-r from-transparent via-white/60 to-transparent"
                          initial={{ x: '-110%' }}
                          animate={{ x: '115%' }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                        />
                      </motion.span>
                    )}
                  </AnimatePresence>

                  {showUnreadBadge && (
                    <motion.span
                      key={`${item.key}-unread`}
                      className="absolute -right-1 -top-1 min-w-[1.4rem] rounded-full bg-amber-400 px-1 text-center text-[10px] font-semibold text-black shadow-[0_0_10px_rgba(245,158,11,0.45)]"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    >
                      {Math.min(unreadKudos ?? 0, 99)}
                    </motion.span>
                  )}

                  {showPendingBadge && (
                    <motion.span
                      key={`${item.key}-pending`}
                      className="absolute -right-1 -top-1 min-w-[1.4rem] rounded-full bg-amber-400 px-1 text-center text-[10px] font-semibold text-black shadow-[0_0_10px_rgba(245,158,11,0.45)]"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    >
                      {Math.min(pendingSync ?? 0, 99)}
                    </motion.span>
                  )}
                </motion.div>

                <motion.span
                  className={[
                    'text-sm font-semibold tracking-[0.08em] text-shadow-pop transition-colors',
                    isActive ? 'text-white' : 'text-white/80 group-hover:text-white group-focus-visible:text-white',
                  ].join(' ')}
                  animate={{ y: isActive ? -2 : 0 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                >
                  {item.label}
                </motion.span>

                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      key={`${item.key}-underline`}
                      className="pointer-events-none absolute bottom-1 left-1/2 h-1 -translate-x-1/2 overflow-hidden rounded-full bg-amber-400/80"
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: underlineWidth }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    />
                  )}
                </AnimatePresence>
              </motion.button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

export default BottomNav
