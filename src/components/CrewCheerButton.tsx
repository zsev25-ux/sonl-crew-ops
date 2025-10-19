import { useCallback, useState } from 'react'
import { httpsCallable } from 'firebase/functions'

import { cloudEnabled, ensureAnonAuth, functions } from '@/lib/firebase'
import { showToast } from '@/lib/toast'

export interface CrewCheerButtonProps {
  targetUserId: string
  currentUserId: string
}

export function CrewCheerButton({ targetUserId, currentUserId }: CrewCheerButtonProps) {
  const [pending, setPending] = useState(false)

  const handleCheer = useCallback(async () => {
    if (!cloudEnabled || !functions) {
      showToast('Online cheer service is snoozing. Try again when connected!', 'warning')
      return
    }
    if (!targetUserId) {
      showToast('We need a crew member to cheer for!', 'warning')
      return
    }
    if (targetUserId === currentUserId) {
      showToast('Self-cheers are adorable, but share the sparkle with a teammate!', 'info')
      return
    }

    setPending(true)
    try {
      await ensureAnonAuth()
      const giveCheer = httpsCallable<{ targetUserId: string }, void>(functions, 'giveCheer')
      await giveCheer({ targetUserId })
      showToast('Cheer sent! ✨', 'info')
    } catch (error) {
      console.error('Unable to send cheer', error)
      showToast('The cheer elves hit a snag. Please try again in a moment.', 'error')
    } finally {
      setPending(false)
    }
  }, [currentUserId, targetUserId, functions])

  return (
    <button
      type="button"
      onClick={handleCheer}
      disabled={pending}
      className={[
        'inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 transition',
        'hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200',
        'disabled:cursor-not-allowed disabled:opacity-60',
      ].join(' ')}
    >
      <span aria-hidden="true">✨</span>
      <span>{pending ? 'Sending Cheer…' : 'Send Cheer'}</span>
    </button>
  )
}

export default CrewCheerButton
