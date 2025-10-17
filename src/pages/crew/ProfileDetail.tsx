import { ChangeEvent, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Camera, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { CrewUser, KudosDocument } from '@/lib/types'
import type { JobRecord } from '@/lib/db'
import { createThumbnailFromFile } from '@/lib/crew'
import { db } from '@/lib/db'
import { enqueueSyncOp } from '@/lib/sync'
import { cloudEnabled } from '@/lib/firebase'

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
}

type ProfileDetailProps = {
  users: CrewUser[]
  kudos: KudosDocument[]
  jobs: JobRecord[]
  onNavigateBack: () => void
}

const MAX_KUDOS = 10
const MAX_JOBS = 10

function ProfileDetailPage({ users, kudos, jobs, onNavigateBack }: ProfileDetailProps) {
  const { userId = '' } = useParams()
  const user = useMemo(() => users.find((entry) => entry.id === userId), [users, userId])
  const [bioDraft, setBioDraft] = useState(user?.bio ?? '')
  const [saving, setSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const targetUserId = user?.id ?? userId

  const recentKudos = useMemo(() => {
    return kudos.filter((entry) => !entry.userRefId || entry.userRefId === targetUserId).slice(0, MAX_KUDOS)
  }, [kudos, targetUserId])
  const recentJobs = useMemo(() => jobs.slice(0, MAX_JOBS), [jobs])

  if (!user) {
    return (
      <div className="space-y-6">
        <Button
          onClick={onNavigateBack}
          className="rounded-full border border-slate-800 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900/60"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to profiles
        </Button>
        <Card className="rounded-3xl border border-white/5 bg-slate-900/70 p-6 text-slate-200">
          Crew member not found.
        </Card>
      </div>
    )
  }

  const handleBioSave = async () => {
    setSaving(true)
    try {
      await db.users.update(user.id, { bio: bioDraft, updatedAt: Date.now() })
      if (cloudEnabled) {
        await enqueueSyncOp({
          type: 'user.update',
          userId: user.id,
          changes: { bio: bioDraft },
        })
      }
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    setAvatarUploading(true)
    try {
      const { blob, dataUrl } = await createThumbnailFromFile(file, 256)
      await db.users.update(user.id, { photoURL: dataUrl, updatedAt: Date.now() })
      if (cloudEnabled) {
        const base64 = await blobToBase64(blob)
        await enqueueSyncOp({
          type: 'user.avatar.upload',
          userId: user.id,
          contentType: blob.type,
          dataUrl: base64,
        })
      }
    } finally {
      setAvatarUploading(false)
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <button
        type="button"
        onClick={onNavigateBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-amber-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to profiles
      </button>

      <Card className="rounded-3xl border border-white/5 bg-slate-900/80">
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="relative h-20 w-20 overflow-hidden rounded-3xl border border-amber-200/30 bg-amber-400/5">
            {user.photoURL ? (
              <img src={user.photoURL} alt={`${user.displayName} avatar`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-amber-200">
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <label className="absolute bottom-2 right-2 inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-300/40 bg-amber-300/20 px-2 py-1 text-xs font-semibold text-amber-200">
              <Camera className="h-3.5 w-3.5" />
              {avatarUploading ? 'Uploading…' : 'Change'}
              <input className="hidden" type="file" accept="image/*" onChange={handleAvatarChange} />
            </label>
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl text-slate-100">{user.displayName}</CardTitle>
            <p className="text-xs uppercase tracking-wide text-slate-400">{user.role}</p>
            <p className="text-xs text-slate-500">Season {user.season?.seasonId ?? 'Preseason'}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Bio</h3>
              <span className="text-xs text-slate-500">Visible to admins</span>
            </div>
            <Textarea
              value={bioDraft}
              onChange={(event) => setBioDraft(event.target.value)}
              rows={4}
              className="mt-3 min-h-[120px] rounded-2xl border border-slate-800 bg-slate-950/80 text-slate-200"
            />
            <div className="mt-3 flex justify-end">
              <Button
                onClick={handleBioSave}
                className="rounded-full bg-amber-500 px-5 text-sm font-semibold text-slate-900 hover:bg-amber-400"
                disabled={saving}
              >
                <Pencil className="mr-2 h-4 w-4" /> Save bio
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <motion.section
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        className="rounded-3xl border border-white/5 bg-slate-900/70 p-6"
      >
        <h3 className="text-lg font-semibold text-slate-100">Recent kudos</h3>
        {recentKudos.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No kudos recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            {recentKudos.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="font-semibold text-slate-100">{entry.crewName || 'Crew kudos'}</p>
                <p className="mt-1 text-slate-300">{entry.message}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(entry.createdAt ?? entry.updatedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      <motion.section
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        className="rounded-3xl border border-white/5 bg-slate-900/70 p-6"
      >
        <h3 className="text-lg font-semibold text-slate-100">Recent jobs</h3>
        {recentJobs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No completed jobs synced yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            {recentJobs.map((job) => (
              <li key={job.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="font-semibold text-slate-100">{job.client}</p>
                <p className="text-sm text-slate-400">{job.scope}</p>
                <p className="mt-2 text-xs text-slate-500">{job.date}</p>
              </li>
            ))}
          </ul>
        )}
      </motion.section>
    </div>
  )
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = (error) => reject(error)
    reader.readAsDataURL(blob)
  })
}

export default ProfileDetailPage
