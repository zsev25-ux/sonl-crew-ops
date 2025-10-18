import React, {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { loadClientsFromFile, loadClientsFromPublic, type Client } from '@/lib/clients'
import {
  addLocalMedia,
  deleteMedia,
  listMedia,
  revokeMediaUrls,
  syncRemoteMedia,
  type JobMedia,
} from '@/lib/media'
import {
  createDefaultJobMeta,
  loadMeta,
  normalizeJobMeta,
  saveMeta,
  type JobMeta,
} from '@/lib/jobmeta'
import { cloudEnabled, ensureAnonAuth, db as cloudDb } from '@/lib/firebase'
import {
  enqueueSyncOp,
  subscribeFirestore,
  syncNow,
  updateConnectivity,
  useSyncStatus,
  processPendingQueue,
  type SyncState,
  type PendingOpPayload,
} from '@/lib/sync'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import {
  FileText,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'

import ReactDOM from "react-dom"
import {
  bootstrapAppData,
  persistActiveDate,
  persistJobs,
  persistPolicy,
  persistUser,
  type BootstrapSource,
} from '@/lib/app-data'
import { db } from '@/lib/db'
import type { CrewOption, Job, JobCore, Policy, Role, User } from '@/lib/types'
import Profiles from './pages/crew/Profiles'
import ProfileDetail from './pages/crew/ProfileDetail'
import Leaderboards from './pages/crew/Leaderboards'
import Awards from './pages/crew/Awards'

const LOGIN_BG = '/FINEASFLOADINGSCREEN.jpg' // place the file in /public

// THEME TOKENS
const THEME = {
  bg: 'bg-gradient-to-br from-[#0a0f16] via-[#0b1220] to-[#0a0f16]',
  panel:
    'border border-slate-800 bg-slate-900/60 shadow-lg shadow-slate-950/40 backdrop-blur-xl',
  panelSubtle: 'border border-slate-800 bg-slate-900/40 shadow-md shadow-slate-950/30 backdrop-blur',
  text: 'text-slate-100',
  subtext: 'text-slate-400',
  amber: 'text-amber-300',
  cta: 'bg-amber-500 hover:bg-amber-400 text-slate-900',
  chip: 'rounded-full border border-amber-400/30 bg-amber-400/15 text-amber-200',
}

const cardVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
}

const fadeInVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

type LeaderboardCategory = 'bonus' | 'speed' | 'quality'
type ReactionEmoji = '🔥' | '💡' | '💪'
type AchievementKey = 'five_streak' | 'route_master' | 'client_favorite'
type View = 'route' | 'board' | 'hq' | 'docs' | 'profile'
type BoardTab = 'clients' | 'admin'
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
const STORAGE_SOURCE_LABEL: Record<BootstrapSource, string> = {
  dexie: 'IndexedDB seed',
  'legacy-localStorage': 'Legacy migration',
  fallback: 'In-memory fallback',
}

type CrewMember = {
  id: string
  name: string
  crew: string
  stats: {
    efficiencyBonuses: number
    averageInstallTime: number
    totalKudos: number
  }
}

type KudosEntry = {
  id: string
  crew: string
  message: string
  image: string
  timestamp: string
  reactions: Record<ReactionEmoji, number>
}

const SAMPLE_CREW_MEMBERS: CrewMember[] = [
  {
    id: 'luke',
    name: 'Luke',
    crew: 'Crew Alpha',
    stats: {
      efficiencyBonuses: 18,
      averageInstallTime: 2.4,
      totalKudos: 46,
    },
  },
  {
    id: 'maria',
    name: 'Maria',
    crew: 'Crew Bravo',
    stats: {
      efficiencyBonuses: 22,
      averageInstallTime: 2.1,
      totalKudos: 52,
    },
  },
  {
    id: 'darius',
    name: 'Darius',
    crew: 'Crew Alpha',
    stats: {
      efficiencyBonuses: 15,
      averageInstallTime: 2.8,
      totalKudos: 38,
    },
  },
  {
    id: 'ava',
    name: 'Ava',
    crew: 'Crew Support',
    stats: {
      efficiencyBonuses: 19,
      averageInstallTime: 2.0,
      totalKudos: 61,
    },
  },
  {
    id: 'jasper',
    name: 'Jasper',
    crew: 'Dispatcher',
    stats: {
      efficiencyBonuses: 12,
      averageInstallTime: 3.1,
      totalKudos: 33,
    },
  },
]

const SAMPLE_KUDOS: KudosEntry[] = [
  {
    id: 'k1',
    crew: 'Crew Alpha',
    message: 'Crushed the Country Ridge install in record time. Zero call-backs.',
    image: '/sample/crew-alpha.jpg',
    timestamp: '2025-11-17T18:45:00Z',
    reactions: {
      '🔥': 12,
      '💡': 3,
      '💪': 8,
    },
  },
  {
    id: 'k2',
    crew: 'Crew Bravo',
    message: 'Maria and team re-lit Patriot Subdivision after the storm. Residents ecstatic.',
    image: '/sample/crew-bravo.jpg',
    timestamp: '2025-11-15T23:12:00Z',
    reactions: {
      '🔥': 7,
      '💡': 5,
      '💪': 11,
    },
  },
  {
    id: 'k3',
    crew: 'Crew Support',
    message: 'Ava turned around three VIP calls in one afternoon, new seasonal record.',
    image: '/sample/crew-support.jpg',
    timestamp: '2025-11-14T15:02:00Z',
    reactions: {
      '🔥': 5,
      '💡': 9,
      '💪': 6,
    },
  },
]

const crewOptions: CrewOption[] = ['Crew Alpha', 'Crew Bravo', 'Both Crews']

type JobFormState = {
  date: string
  crew: string
  client: string
  scope: string
  notes: string
  address: string
  neighborhood: string
  zip: string
  houseTier: string
  rehangPrice: string
  lifetimeSpend: string
  vip: boolean
  materials: MaterialsInputState
}

const getPlannedHoursForJob = (job: Job): number => {
  if (typeof job.houseTier === 'number') {
    return TIER_HOURS[job.houseTier] ?? DEFAULT_JOB_HOURS
  }

  return DEFAULT_JOB_HOURS
}

const CREW_PINS = {
  Admin: '0000',
  'Crew Alpha': '1111',
  'Crew Bravo': '2222',
  Dispatcher: '3333',
  'Crew Support': '4444',
} as const

const ROLE_BY_CREW: Record<keyof typeof CREW_PINS, Role> = {
  Admin: 'admin',
  'Crew Alpha': 'crew',
  'Crew Bravo': 'crew',
  Dispatcher: 'dispatcher',
  'Crew Support': 'support',
}

const getRoleForCrew = (name: string): Role =>
  ROLE_BY_CREW[name as keyof typeof CREW_PINS] ?? 'crew'

const isRole = (value: unknown): value is Role =>
  value === 'admin' || value === 'crew' || value === 'dispatcher' || value === 'support'

const isPinValid = (name: string, pin: string): boolean => {
  const normalizedPin = pin.trim()
  if (!name || !normalizedPin) {
    return false
  }

  const expected = CREW_PINS[name as keyof typeof CREW_PINS]
  if (!expected) {
    return false
  }

  return expected === normalizedPin
}

async function restoreCachedUser(): Promise<User | null> {
  try {
    await db.open()
    const record = await db.state.get('currentUser')
    if (!record || !record.value || typeof record.value !== 'object') {
      return null
    }
    const candidate = record.value as Partial<User>
    if (typeof candidate.name === 'string') {
      return { name: candidate.name, role: getRoleForCrew(candidate.name) }
    }
  } catch (error) {
    console.warn('Unable to restore cached user', error)
  }
  return null
}

const stripesStyles = `
  @keyframes sonl-stripes {
    from {
      background-position: 0 0;
    }
    to {
      background-position: 200% 0;
    }
  }

  .sonl-stripes {
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.2), transparent);
    background-size: 200% 100%;
    animation: sonl-stripes 2.2s linear infinite;
  }
`

const HOURS_PER_DAY_LIMIT = 8
const DEFAULT_JOB_HOURS = 2.5
const TIER_HOURS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
}

const roofTypeOptions: Exclude<JobMeta['roofType'], undefined>[] = [
  'single-story',
  'two-story',
  'steep',
  'flat',
]

const statusOptions: Exclude<JobMeta['status'], undefined>[] = [
  'Not started',
  'In progress',
  'Done',
]

const materialFields = [
  { key: 'zWireFt', label: 'Z-Wire (ft)', step: 0.1, integer: false },
  { key: 'malePlugs', label: 'Male plugs', step: 1, integer: true },
  { key: 'femalePlugs', label: 'Female plugs', step: 1, integer: true },
  { key: 'timers', label: 'Timer(s)', step: 1, integer: true },
] as const

type MaterialField = typeof materialFields[number]
type MaterialKey = MaterialField['key']

type MaterialsInputState = Record<MaterialKey, string>

const MATERIAL_FIELD_MAP: Record<MaterialKey, MaterialField> = materialFields.reduce(
  (acc, field) => {
    acc[field.key] = field
    return acc
  },
  {} as Record<MaterialKey, MaterialField>,
)

const MATERIAL_KEYS = materialFields.map((field) => field.key) as MaterialKey[]

const formatMaterialNumber = (value: number, integer: boolean): string => {
  if (integer) {
    return String(Math.max(0, Math.floor(value)))
  }
  return (Math.round(Math.max(0, value) * 100) / 100).toString()
}

const parseMaterialInput = (raw: string, integer: boolean): number => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return 0
  }
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  const clamped = Math.max(0, numeric)
  return integer ? Math.floor(clamped) : Math.round(clamped * 100) / 100
}

const toMaterialsInputState = (materials: JobMeta['materials']): MaterialsInputState =>
  MATERIAL_KEYS.reduce<MaterialsInputState>((acc, key) => {
    const { integer } = MATERIAL_FIELD_MAP[key]
    acc[key] = formatMaterialNumber(materials[key], integer)
    return acc
  }, {} as MaterialsInputState)

const JOB_COMPARE_KEYS: (keyof Job)[] = [
  'date',
  'crew',
  'client',
  'scope',
  'notes',
  'address',
  'neighborhood',
  'zip',
  'houseTier',
  'rehangPrice',
  'lifetimeSpend',
  'vip',
]

const areJobsEqual = (a: Job | undefined, b: Job | undefined): boolean => {
  if (!a || !b) {
    return false
  }
  return JOB_COMPARE_KEYS.every((key) => a[key] === b[key])
}

const arePoliciesEqual = (a: Policy, b: Policy): boolean =>
  a.cutoffDateISO === b.cutoffDateISO &&
  a.maxJobsPerDay === b.maxJobsPerDay &&
  a.blockedClients.length === b.blockedClients.length &&
  a.blockedClients.every((client, index) => client === b.blockedClients[index])

const titleCase = (value: string): string =>
  value
    .split(/[\s-]+/)
    .map((segment) =>
      segment.length > 0
        ? segment[0].toUpperCase() + segment.slice(1)
        : segment,
    )
    .join(' ')

const formatHours = (hours: number): string => {
  if (!Number.isFinite(hours)) {
    return '0'
  }
  const rounded = Number(hours.toFixed(1))
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : rounded.toFixed(1)
}

const formatRelativeTimestamp = (value: number | null): string => {
  if (!value) {
    return 'Never'
  }
  const diff = Date.now() - value
  if (diff < 60_000) {
    return 'Just now'
  }
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const defaultPolicy: Policy = {
  cutoffDateISO: '2025-12-31',
  blockedClients: ['James Jonna', 'Earl Wiggley', 'Jeff Innes'],
  maxJobsPerDay: 2,
}

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

const todayIso = new Date().toISOString().slice(0, 10)

const initialJobs: Job[] = [
  {
    id: 1,
    date: '2025-11-28',
    crew: 'Crew Alpha',
    client: 'Byrd Supply Co.',
    scope: 'Warehouse mezzanine install',
    notes: 'Requires forklift on-site by 8am.',
  },
  {
    id: 2,
    date: '2025-11-28',
    crew: 'Crew Bravo',
    client: 'City of Ypsilanti',
    scope: 'Holiday lighting run-through',
  },
  {
    id: 3,
    date: '2025-11-30',
    crew: 'Both Crews',
    client: 'Fisher Theatre',
    scope: 'Stage rigging refit',
    notes: 'Safety briefing with venue lead before load-in.',
  },
]

const initialActiveDate = initialJobs[0]?.date ?? todayIso
const quickCrewChoices = Array.from(new Set<string>([...crewOptions, 'Crew 1']))

const createEmptyForm = (
  overrides: Partial<JobFormState> = {},
): JobFormState => {
  const { materials: materialOverrides, ...restOverrides } = overrides
  const defaultMaterials = toMaterialsInputState(createDefaultJobMeta().materials)
  return {
    date: '',
    crew: crewOptions[0],
    client: '',
    scope: '',
    notes: '',
    address: '',
    neighborhood: '',
    zip: '',
    houseTier: '',
    rehangPrice: '',
    lifetimeSpend: '',
    vip: false,
    materials: materialOverrides
      ? {
          ...defaultMaterials,
          ...materialOverrides,
        }
      : defaultMaterials,
    ...restOverrides,
  }
}

const toOptionalString = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const toOptionalNumber = (value: string): number | undefined => {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const sanitized = trimmed.replace(/[$,]/g, '')
  const parsed = Number(sanitized)
  return Number.isFinite(parsed) ? parsed : undefined
}

const toJobPayload = (form: JobFormState): JobCore => {
  const meta = createDefaultJobMeta()
  const materials = { ...meta.materials }
  MATERIAL_KEYS.forEach((key) => {
    const { integer } = MATERIAL_FIELD_MAP[key]
    materials[key] = parseMaterialInput(form.materials[key], integer)
  })
  meta.materials = materials

  return {
    date: form.date,
    crew: form.crew,
    client: form.client.trim(),
    scope: form.scope.trim(),
    notes: toOptionalString(form.notes),
    address: toOptionalString(form.address),
    neighborhood: toOptionalString(form.neighborhood),
    zip: toOptionalString(form.zip),
    houseTier: toOptionalNumber(form.houseTier),
    rehangPrice: toOptionalNumber(form.rehangPrice),
    lifetimeSpend: toOptionalNumber(form.lifetimeSpend),
    vip: form.vip,
    meta,
  }
}

const sortJobs = (list: Job[]): Job[] =>
  [...list].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) {
      return byDate
    }

    return a.id - b.id
  })

const sanitizeJobs = (value: unknown, fallback: Job[]): Job[] => {
  if (!Array.isArray(value)) {
    return sortJobs(fallback)
  }

  if (value.length === 0) {
    return []
  }

  const sanitized: Job[] = []
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      return
    }
    const record = raw as Partial<Job>
    const date = typeof record.date === 'string' ? record.date : ''
    const crew = typeof record.crew === 'string' ? record.crew : ''
    const client = typeof record.client === 'string' ? record.client : ''
    const scope = typeof record.scope === 'string' ? record.scope : ''
    if (!date || !crew || !client || !scope) {
      return
    }

    sanitized.push({
      id:
        typeof record.id === 'number' && Number.isFinite(record.id)
          ? record.id
          : Date.now() + index,
      date,
      crew,
      client,
      scope,
      notes:
        typeof record.notes === 'string' ? record.notes : undefined,
      address:
        typeof record.address === 'string' ? record.address : undefined,
      neighborhood:
        typeof record.neighborhood === 'string'
          ? record.neighborhood
          : undefined,
      zip: typeof record.zip === 'string' ? record.zip : undefined,
      houseTier:
        typeof record.houseTier === 'number' && Number.isFinite(record.houseTier)
          ? record.houseTier
          : undefined,
      rehangPrice:
        typeof record.rehangPrice === 'number' &&
        Number.isFinite(record.rehangPrice)
          ? record.rehangPrice
          : undefined,
      lifetimeSpend:
        typeof record.lifetimeSpend === 'number' &&
        Number.isFinite(record.lifetimeSpend)
          ? record.lifetimeSpend
          : undefined,
      vip: Boolean(record.vip),
    })
  })

  if (sanitized.length === 0) {
    return sortJobs(fallback)
  }

  return sortJobs(sanitized)
}

const sanitizePolicy = (value: unknown, fallback: Policy): Policy => {
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const record = value as Partial<Policy>
  const cutoff =
    typeof record.cutoffDateISO === 'string' && record.cutoffDateISO
      ? record.cutoffDateISO
      : fallback.cutoffDateISO

  const blocked = Array.isArray(record.blockedClients)
    ? record.blockedClients
        .map((name) =>
          typeof name === 'string' ? name : String(name ?? '').trim(),
        )
        .filter((name) => name.length > 0)
    : fallback.blockedClients

  const maxJobs =
    typeof record.maxJobsPerDay === 'number' && record.maxJobsPerDay > 0
      ? Math.floor(record.maxJobsPerDay)
      : fallback.maxJobsPerDay

  return {
    cutoffDateISO: cutoff,
    blockedClients: blocked,
    maxJobsPerDay: maxJobs,
  }
}

const sanitizeActiveDate = (value: unknown, fallback: string): string => {
  if (typeof value === 'string') {
    return value
  }

  return fallback
}

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }

  const raw = String(value)
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }

  return raw
}

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function validateNewJob(
  newJob: JobCore,
  existingJobs: Job[],
  policy: Policy,
): string | null {
  if (!newJob.date || !newJob.client || !newJob.scope) {
    return 'Date, client, and scope are required to schedule a job.'
  }

  const selectedDate = new Date(newJob.date)
  if (Number.isNaN(selectedDate.getTime())) {
    return 'Please choose a valid date.'
  }

  const sameDayJobs = existingJobs.filter((job) => job.date === newJob.date)
  const maxJobsPerDay = policy.maxJobsPerDay || defaultPolicy.maxJobsPerDay

  if (sameDayJobs.length >= maxJobsPerDay) {
    return `Only ${maxJobsPerDay} ${
      maxJobsPerDay === 1 ? 'job' : 'jobs'
    } may run on a single day.`
  }

  if (
    newJob.crew === 'Both Crews' &&
    (sameDayJobs.length > 0 ||
      sameDayJobs.some((job) => job.crew === 'Both Crews'))
  ) {
    return 'Both Crews assignments must be the only job for that day.'
  }

  if (sameDayJobs.some((job) => job.crew === 'Both Crews')) {
    return 'Cannot add more work to a day reserved for both crews.'
  }

  const blockedSet = new Set(
    (policy.blockedClients ?? defaultPolicy.blockedClients)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )
  const normalizedClient = newJob.client.trim().toLowerCase()

  if (normalizedClient && blockedSet.has(normalizedClient)) {
    return `Client ${newJob.client.trim()} is currently suspended.`
  }

  return null
}

function AuthedShell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const sanitizedInitialJobs = useMemo(
    () => sanitizeJobs(initialJobs, initialJobs),
    [],
  )
  const sanitizedDefaultPolicy = useMemo(
    () => sanitizePolicy(defaultPolicy, defaultPolicy),
    [],
  )
  const [jobs, setJobs] = useState<Job[]>(sanitizedInitialJobs)
  const [policy, setPolicy] = useState<Policy>(sanitizedDefaultPolicy)
  const [view, setView] = useState<View>('route')
  const [boardTab, setBoardTab] = useState<BoardTab>('clients')
  const [activeDate, setActiveDate] = useState<string>(initialActiveDate)
  const [storageReady, setStorageReady] = useState(false)
  const [storageSource, setStorageSource] = useState<BootstrapSource>('fallback')
  const [dexieAvailable, setDexieAvailable] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const syncStatus = useSyncStatus()
  const syncEnabled = cloudEnabled && Boolean(cloudDb)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installDismissed, setInstallDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }
    try {
      return window.localStorage.getItem('sonl-install-dismissed') === '1'
    } catch (error) {
      console.warn('Unable to read install prompt preference', error)
      return false
    }
  })
  const [appInstalled, setAppInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }
    try {
      const standaloneMedia = window.matchMedia?.('(display-mode: standalone)')
      const standaloneIOS = (window.navigator as unknown as { standalone?: boolean }).standalone
      return Boolean(standaloneMedia?.matches || standaloneIOS)
    } catch {
      return false
    }
  })
  const previousJobsRef = useRef<Job[]>(sanitizedInitialJobs)
  const suppressJobsQueueRef = useRef(false)
  const previousPolicyRef = useRef<Policy>(sanitizedDefaultPolicy)
  const suppressPolicyQueueRef = useRef(false)

  const [scheduleForm, setScheduleForm] = useState<JobFormState>(() =>
    createEmptyForm({ date: activeDate }),
  )
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null)

  const [quickAddForm, setQuickAddForm] = useState<JobFormState>(() =>
    createEmptyForm({ date: activeDate }),
  )
  const [quickError, setQuickError] = useState<string | null>(null)
  const [quickNotice, setQuickNotice] = useState<string | null>(null)

  const [clients, setClients] = useState<Client[]>([])
  const [clientsError, setClientsError] = useState<string | null>(null)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clientPage, setClientPage] = useState(1)
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const jobMetaCacheRef = useRef<Map<number, JobMeta>>(new Map())
  const [jobMetaDraft, setJobMetaDraft] = useState<JobMeta>(() =>
    createDefaultJobMeta(),
  )
  const defaultMaterialInputs = useMemo(
    () => toMaterialsInputState(createDefaultJobMeta().materials),
    [],
  )
  const [materialInputs, setMaterialInputs] = useState<MaterialsInputState>(
    defaultMaterialInputs,
  )
  const materialInputsRef = useRef<MaterialsInputState>(defaultMaterialInputs)
  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaStatusMessage, setMetaStatusMessage] = useState<string | null>(null)
  const [metaSavedAt, setMetaSavedAt] = useState<number | null>(null)
  const [crewNotesSaving, setCrewNotesSaving] = useState(false)
  const previousJobIdRef = useRef<number | null>(null)
  const notesPrevValueRef = useRef<string | undefined>(undefined)
  const crewNotesAutoSaveTimeoutRef = useRef<number | null>(null)

  const [mediaItems, setMediaItems] = useState<JobMedia[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [mediaSyncing, setMediaSyncing] = useState(false)

  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const copyStatusTimeoutRef = useRef<number | null>(null)

  const quickAddButtonRef = useRef<HTMLButtonElement>(null)
  const quickAddSectionRef = useRef<HTMLDivElement>(null)
  const clientFileInputRef = useRef<HTMLInputElement>(null)
  const adminImportInputRef = useRef<HTMLInputElement>(null)

  const handleDismissInstall = useCallback(() => {
    setInstallDismissed(true)
    setInstallPromptEvent(null)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('sonl-install-dismissed', '1')
      } catch {
        /* noop */
      }
    }
  }, [])

  const handleInstallClick = useCallback(async () => {
    if (!installPromptEvent) {
      return
    }
    try {
      await installPromptEvent.prompt()
      const choice = await installPromptEvent.userChoice
      if (choice.outcome === 'accepted') {
        setAppInstalled(true)
      }
    } catch (error) {
      console.warn('Install prompt failed', error)
    } finally {
      handleDismissInstall()
    }
  }, [handleDismissInstall, installPromptEvent])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)')

    const updateInstalled = () => {
      try {
        const standalone = Boolean(mediaQuery?.matches)
          || Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
        if (standalone) {
          setAppInstalled(true)
          handleDismissInstall()
        }
      } catch {
        /* noop */
      }
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault()
      if (installDismissed) {
        return
      }
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setAppInstalled(true)
      handleDismissInstall()
    }

    updateInstalled()
    mediaQuery?.addEventListener?.('change', updateInstalled)
    window.addEventListener('beforeinstallprompt', handleBeforeInstall as EventListener)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      mediaQuery?.removeEventListener?.('change', updateInstalled)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall as EventListener)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [handleDismissInstall, installDismissed])

  useEffect(() => {
    setView('route')
    setBoardTab('clients')
  }, [user.name])

  const lastSyncLabel = useMemo(() => formatRelativeTimestamp(syncStatus.lastSyncedAt), [syncStatus.lastSyncedAt])
  const showInstallCta = !appInstalled && Boolean(installPromptEvent) && !installDismissed
  const showInstallHint = !appInstalled && !installPromptEvent && !installDismissed

  useEffect(() => {
    materialInputsRef.current = materialInputs
  }, [materialInputs])

  useEffect(() => {
    updateConnectivity(typeof navigator === 'undefined' ? true : navigator.onLine)
    if (typeof window === 'undefined') {
      return
    }
    const handleOnline = () => {
      updateConnectivity(true)
      void processPendingQueue()
    }
    const handleOffline = () => {
      updateConnectivity(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const fallbackSnapshot = {
      jobs: sanitizedInitialJobs,
      policy: sanitizedDefaultPolicy,
      activeDate: initialActiveDate,
      user: null,
    }

    const hydrate = async () => {
      try {
        const result = await bootstrapAppData(fallbackSnapshot)
        if (cancelled) {
          return
        }
        const nextJobs = sanitizeJobs(result.snapshot.jobs, sanitizedInitialJobs)
        const nextPolicy = sanitizePolicy(result.snapshot.policy, sanitizedDefaultPolicy)
        const nextActiveDate = sanitizeActiveDate(
          result.snapshot.activeDate,
          nextJobs[0]?.date ?? initialActiveDate,
        )
        previousJobsRef.current = nextJobs
        suppressJobsQueueRef.current = true
        previousPolicyRef.current = nextPolicy
        suppressPolicyQueueRef.current = true
        setJobs(nextJobs)
        setPolicy(nextPolicy)
        setActiveDate(nextActiveDate)
        setStorageSource(result.source)
        setDexieAvailable(result.dexieAvailable)
        setStorageReady(true)
      } catch (error) {
        console.error('Failed to hydrate app data', error)
        if (!cancelled) {
          setStorageError('Offline data unavailable — running in memory only.')
          setStorageReady(true)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [initialActiveDate, sanitizedDefaultPolicy, sanitizedInitialJobs])

  useEffect(() => {
    if (!storageReady || !syncEnabled) {
      return
    }
    const unsubscribe = subscribeFirestore({
      onJobs: (incomingJobs) => {
        const sanitized = sortJobs(sanitizeJobs(incomingJobs, []))
        suppressJobsQueueRef.current = true
        previousJobsRef.current = sanitized
        setJobs(sanitized)
      },
      onPolicy: (incomingPolicy) => {
        suppressPolicyQueueRef.current = true
        previousPolicyRef.current = incomingPolicy
        setPolicy(incomingPolicy)
      },
    })
    return unsubscribe
  }, [storageReady, syncEnabled])

  const blockedClientSummary = useMemo(() => {
    const normalized = policy.blockedClients
      .map((name) => name.trim())
      .filter(Boolean)
    return normalized.length > 0 ? normalized.join(', ') : 'None'
  }, [policy.blockedClients])

  const jobsPerDayLabel = policy.maxJobsPerDay === 1 ? 'job' : 'jobs'

  useEffect(() => {
    if (scheduleForm.date) {
      setActiveDate(scheduleForm.date)
    }
  }, [scheduleForm.date])

  useEffect(() => {
    setClientPage(1)
  }, [clientSearch, clients.length])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    setScheduleForm((prev) =>
      prev.date === activeDate ? prev : { ...prev, date: activeDate },
    )
    setQuickAddForm((prev) =>
      prev.date === activeDate ? prev : { ...prev, date: activeDate },
    )
  }, [activeDate, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await persistJobs(jobs)
          setStorageError(null)
        } catch (error) {
          console.error('Failed to persist jobs', error)
          setStorageError('Unable to sync jobs to offline cache.')
        }
      })()
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [jobs, storageReady])

  useEffect(() => {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine
    if (!storageReady || !syncEnabled || !online) {
      return
    }
    void processPendingQueue()
  }, [storageReady, syncEnabled])

  useEffect(() => {
    if (!storageReady || !syncEnabled) {
      previousJobsRef.current = jobs
      return
    }
    if (suppressJobsQueueRef.current) {
      suppressJobsQueueRef.current = false
      previousJobsRef.current = jobs
      return
    }
    const prev = previousJobsRef.current
    previousJobsRef.current = jobs

    const prevMap = new Map<number, Job>()
    prev.forEach((job) => {
      prevMap.set(job.id, job)
    })

    const ops: PendingOpPayload[] = []
    for (const job of jobs) {
      const previous = prevMap.get(job.id)
      if (!previous) {
        ops.push({ type: 'job.add', job })
      } else if (!areJobsEqual(previous, job)) {
        ops.push({ type: 'job.update', job })
      }
      prevMap.delete(job.id)
    }

    for (const removed of prevMap.values()) {
      ops.push({ type: 'job.delete', jobId: removed.id })
    }

    if (ops.length > 0) {
      void (async () => {
        for (const op of ops) {
          await enqueueSyncOp(op)
        }
      })()
    }
  }, [jobs, storageReady, syncEnabled])

  useEffect(() => {
    if (!storageReady || !syncEnabled) {
      previousPolicyRef.current = policy
      return
    }
    if (suppressPolicyQueueRef.current) {
      suppressPolicyQueueRef.current = false
      previousPolicyRef.current = policy
      return
    }

    if (!arePoliciesEqual(previousPolicyRef.current, policy)) {
      previousPolicyRef.current = policy
      void enqueueSyncOp({ type: 'policy.update', policy })
    }
  }, [policy, storageReady, syncEnabled])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await persistPolicy(policy)
          setStorageError(null)
        } catch (error) {
          console.error('Failed to persist policy', error)
          setStorageError('Unable to sync policy to offline cache.')
        }
      })()
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [policy, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await persistActiveDate(activeDate)
          setStorageError(null)
        } catch (error) {
          console.error('Failed to persist active date', error)
          setStorageError('Unable to sync active date to offline cache.')
        }
      })()
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [activeDate, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    void (async () => {
      try {
        await persistUser(user)
        setStorageError(null)
      } catch (error) {
        console.error('Failed to persist user state', error)
        setStorageError('Unable to sync crew login state to offline cache.')
      }
    })()
  }, [user, storageReady])

  const groupedJobs = useMemo(() => {
    const byDate = new Map<string, Job[]>()
    for (const job of jobs) {
      const list = byDate.get(job.date) ?? []
      list.push(job)
      byDate.set(job.date, list)
    }

    return Array.from(byDate.entries()).sort(([dateA], [dateB]) =>
      dateA.localeCompare(dateB),
    )
  }, [jobs])

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase()
    if (!term) {
      return clients
    }

    return clients.filter((client) => {
      const haystack = [
        client.name,
        client.address,
        client.neighborhood,
        client.zip,
        String(client.houseTier ?? ''),
        String(client.rehangPrice ?? ''),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(term)
    })
  }, [clientSearch, clients])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize))
  const currentPage = Math.min(clientPage, totalPages)
  const paginatedClients = filteredClients.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  const getCachedMeta = useCallback(
    (jobId: number): JobMeta => {
      const cached = jobMetaCacheRef.current.get(jobId)
      if (cached) {
        return cached
      }

      const meta = loadMeta(String(jobId))
      jobMetaCacheRef.current.set(jobId, meta)
      return meta
    },
    [],
  )

  const persistMetaForJob = useCallback(
    (jobId: number, meta: JobMeta, options?: { silent?: boolean }) => {
      saveMeta(String(jobId), meta)
      jobMetaCacheRef.current.set(jobId, meta)
      notesPrevValueRef.current = meta.crewNotes
      setMetaDirty(false)
      setMetaSavedAt(Date.now())
      if (options?.silent) {
        return
      }

      const timestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      setMetaStatusMessage(`Saved at ${timestamp}`)
    },
    [],
  )

  const activeDayJobs = useMemo(
    () => jobs.filter((job) => job.date === activeDate),
    [jobs, activeDate],
  )

  useEffect(() => {
    if (activeDayJobs.length === 0) {
      setActiveJobId(null)
      return
    }

    setActiveJobId((current) => {
      if (current && activeDayJobs.some((job) => job.id === current)) {
        return current
      }
      return activeDayJobs[0]?.id ?? null
    })
  }, [activeDayJobs])

  const activeJob = useMemo(() => {
    if (!activeJobId) {
      return null
    }

    return jobs.find((job) => job.id === activeJobId) ?? null
  }, [jobs, activeJobId])

  const plannedHoursForActiveDay = useMemo(() => {
    return activeDayJobs.reduce(
      (total, job) => total + getPlannedHoursForJob(job),
      0,
    )
  }, [activeDayJobs])

  const plannedHoursPercent = Math.min(
    100,
    HOURS_PER_DAY_LIMIT > 0
      ? (plannedHoursForActiveDay / HOURS_PER_DAY_LIMIT) * 100
      : 0,
  )

  const dayOverCapacity = plannedHoursForActiveDay > HOURS_PER_DAY_LIMIT

  const unsyncedMediaCount = useMemo(
    () => mediaItems.filter((item) => item.status !== 'synced').length,
    [mediaItems],
  )

  const needsMigration = cloudEnabled && unsyncedMediaCount > 0

  useEffect(() => {
    if (
      lightboxIndex !== null &&
      (lightboxIndex < 0 || lightboxIndex >= mediaItems.length)
    ) {
      setLightboxIndex(null)
    }
  }, [lightboxIndex, mediaItems.length])

  const currentLightboxItem =
    lightboxIndex !== null && mediaItems[lightboxIndex]
      ? mediaItems[lightboxIndex]
      : null

  const currentLightboxPreview = currentLightboxItem
    ? currentLightboxItem.previewUrl ?? currentLightboxItem.remoteUrl ?? currentLightboxItem.localUrl ?? ''
    : ''
  const currentLightboxIsImage = Boolean(currentLightboxItem?.type?.startsWith('image/'))

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null)
  }, [])

  const showNextLightbox = useCallback(() => {
    setLightboxIndex((current) => {
      if (current === null || mediaItems.length === 0) {
        return current
      }
      return (current + 1) % mediaItems.length
    })
  }, [mediaItems])

  const showPrevLightbox = useCallback(() => {
    setLightboxIndex((current) => {
      if (current === null || mediaItems.length === 0) {
        return current
      }
      return (current - 1 + mediaItems.length) % mediaItems.length
    })
  }, [mediaItems])

  const handleMetaSaveClick = useCallback(() => {
    if (!activeJob) {
      return
    }
    setMetaSaving(true)
    persistMetaForJob(activeJob.id, jobMetaDraft)
    setMetaSaving(false)
  }, [activeJob, cloudEnabled, jobMetaDraft, persistMetaForJob])

  const handleStatusChange = useCallback(
    (status: Exclude<JobMeta['status'], undefined>) => {
      if (!activeJob) {
        return
      }

      const finishedAt =
        status === 'Done'
          ? Date.now()
          : status === 'In progress'
            ? null
            : null

      const nextMeta: JobMeta = {
        ...jobMetaDraft,
        status,
        finishedAt,
      }

      setJobMetaDraft(nextMeta)
      persistMetaForJob(activeJob.id, nextMeta)
    },
    [activeJob, jobMetaDraft, persistMetaForJob],
  )

  const handleStartJob = useCallback(() => {
    if (!activeJob) {
      return
    }

    const nextMeta: JobMeta = {
      ...jobMetaDraft,
      status: 'In progress',
      finishedAt: null,
    }
    setJobMetaDraft(nextMeta)
    persistMetaForJob(activeJob.id, nextMeta)
  }, [activeJob, jobMetaDraft, persistMetaForJob])

  const handleStopJob = useCallback(() => {
    if (!activeJob) {
      return
    }
    if (
      !window.confirm(
        'Wrap this job? Marking done will notify the crews the work is finished.',
      )
    ) {
      return
    }

    const nextMeta: JobMeta = {
      ...jobMetaDraft,
      status: 'Done',
      finishedAt: Date.now(),
    }
    setJobMetaDraft(nextMeta)
    persistMetaForJob(activeJob.id, nextMeta)
  }, [activeJob, jobMetaDraft, persistMetaForJob])

  const handleMaterialInputChange = useCallback(
    (key: MaterialKey) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setMaterialInputs((prev) => {
        if (prev[key] === value) {
          return prev
        }
        return { ...prev, [key]: value }
      })
    },
    [],
  )

  const handleMaterialInputBlur = useCallback(
    (key: MaterialKey) => () => {
      const { integer } = MATERIAL_FIELD_MAP[key]
      const raw = materialInputsRef.current[key]
      const sanitized = parseMaterialInput(raw, integer)
      const formatted = formatMaterialNumber(sanitized, integer)

      setMaterialInputs((prev) => {
        if (prev[key] === formatted) {
          return prev
        }
        return { ...prev, [key]: formatted }
      })

      setJobMetaDraft((prev) => {
        const currentMaterials = prev.materials
        if (currentMaterials[key] === sanitized) {
          return prev
        }
        setMetaDirty(true)
        return {
          ...prev,
          materials: {
            ...currentMaterials,
            [key]: sanitized,
          },
        }
      })
    },
    [],
  )

  const handleMetaTextChange = useCallback(
    (key: Extract<
      keyof JobMeta,
      'colorPattern' | 'powerNotes' | 'hazards' | 'gateCode' | 'contactPhone'
    >) => {
      return (event: ChangeEvent<HTMLInputElement>) => {
        const rawValue = event.target.value
        const trimmed = rawValue.trim()
        setJobMetaDraft((prev) => {
          setMetaDirty(true)
          return {
            ...prev,
            [key]: trimmed ? rawValue : undefined,
          }
        })
      }
    },
    [],
  )

  const handleRoofTypeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value
      setJobMetaDraft((prev) => {
        const nextValue = value ? (value as JobMeta['roofType']) : undefined
        if (prev.roofType === nextValue) {
          return prev
        }
        setMetaDirty(true)
        return {
          ...prev,
          roofType: nextValue,
        }
      })
    },
    [],
  )

  const handleCrewNotesChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      setJobMetaDraft((prev) => {
        if (prev.crewNotes === value) {
          return prev
        }
        setMetaDirty(true)
        return {
          ...prev,
          crewNotes: value,
        }
      })
    },
    [],
  )

  const handleMediaSelection = useCallback(
    async (fileList: FileList | null) => {
      if (!activeJob || !fileList || fileList.length === 0) {
        return
      }

      const jobIdKey = String(activeJob.id)
      const files = Array.from(fileList).filter(
        (file) => file.type.startsWith('image/') || file.type.startsWith('video/'),
      )

      if (files.length === 0) {
        return
      }

      setMediaLoading(true)
      setMediaError(null)

      try {
        const createdIds: string[] = []
        for (const file of files) {
          const id = await addLocalMedia(file, jobIdKey)
          createdIds.push(id)
          if (cloudEnabled) {
            await enqueueSyncOp({ type: 'media.upload', mediaId: id })
          }
        }

        if (cloudEnabled) {
          await syncRemoteMedia(jobIdKey).catch((error) => {
            console.warn('Unable to refresh media after upload', error)
          })
        }

        if (createdIds.length > 0) {
          const refreshed = await listMedia(jobIdKey)
          setMediaItems((prev) => {
            if (prev.length > 0) {
              revokeMediaUrls(prev)
            }
            return refreshed
          })
        }
        setMediaError(null)
      } catch (error) {
        setMediaError(
          error instanceof Error
            ? error.message
            : 'Unable to save media for this job.',
        )
      } finally {
        setMediaLoading(false)
      }
    },
    [activeJob, cloudEnabled],
  )

  const handleDeleteMedia = useCallback(
    async (id: string) => {
      if (!activeJob) {
        return
      }

      const jobIdKey = String(activeJob.id)
      setMediaLoading(true)
      try {
        await deleteMedia(id)
        if (cloudEnabled) {
          await syncRemoteMedia(jobIdKey).catch((error) => {
            console.warn('Unable to refresh media after deletion', error)
          })
        }
        const refreshed = await listMedia(jobIdKey)
        setMediaItems((prev) => {
          if (prev.length > 0) {
            revokeMediaUrls(prev)
          }
          return refreshed
        })
        setMediaError(null)
      } catch (error) {
        setMediaError(
          error instanceof Error
            ? error.message
            : 'Unable to delete media item.',
        )
      } finally {
        setMediaLoading(false)
      }
    },
    [activeJob, cloudEnabled],
  )

  const handleSyncMedia = useCallback(async () => {
    if (!activeJob || !cloudEnabled) {
      return
    }

    const jobIdKey = String(activeJob.id)
    setMediaSyncing(true)
    setMediaLoading(true)
    setMediaError(null)

    try {
      await syncNow()
      await syncRemoteMedia(jobIdKey)
      const refreshed = await listMedia(jobIdKey)
      setMediaItems((prev) => {
        if (prev.length > 0) {
          revokeMediaUrls(prev)
        }
        return refreshed
      })
    } catch (error) {
      setMediaError(
        error instanceof Error
          ? error.message
          : 'Unable to sync media. Please try again.',
      )
    } finally {
      setMediaSyncing(false)
      setMediaLoading(false)
    }
  }, [activeJob, cloudEnabled])

  const handleCopyAddress = useCallback(() => {
    if (!activeJob) {
      return
    }

    const parts = [
      activeJob.address,
      activeJob.neighborhood,
      activeJob.zip,
    ].filter(Boolean)
    const scheduleMessage = (message: string) => {
      setCopyStatus(message)
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current)
      }
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus(null)
        copyStatusTimeoutRef.current = null
      }, 2000)
    }

    if (parts.length === 0) {
      scheduleMessage('No address on file')
      return
    }

    const text = parts.join(', ')

    const commitSuccess = () => {
      scheduleMessage('Address copied')
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard
        .writeText(text)
        .then(commitSuccess)
        .catch(() => {
          scheduleMessage('Copy failed')
        })
      return
    }

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      const successful = document.execCommand('copy')
      if (successful) {
        commitSuccess()
      } else {
        scheduleMessage('Copy failed')
      }
    } catch (error) {
      console.error('Copy failed', error)
      scheduleMessage('Copy failed')
    } finally {
      document.body.removeChild(textarea)
    }
  }, [activeJob])

  useEffect(() => {
    if (crewNotesAutoSaveTimeoutRef.current !== null) {
      window.clearTimeout(crewNotesAutoSaveTimeoutRef.current)
      crewNotesAutoSaveTimeoutRef.current = null
    }

    if (!activeJob) {
      const resetMeta = createDefaultJobMeta()
      setJobMetaDraft(resetMeta)
      const resetInputs = toMaterialsInputState(resetMeta.materials)
      materialInputsRef.current = resetInputs
      setMaterialInputs(resetInputs)
      setMetaDirty(false)
      setMetaSaving(false)
      setMetaStatusMessage(null)
      setMetaSavedAt(null)
      setCrewNotesSaving(false)
      previousJobIdRef.current = null
      notesPrevValueRef.current = undefined
      setMediaItems((prev) => {
        if (prev.length > 0) {
          revokeMediaUrls(prev)
        }
        return []
      })
      setMediaError(null)
      setLightboxIndex(null)
      return
    }

    previousJobIdRef.current = activeJob.id
    const meta = loadMeta(String(activeJob.id))
    jobMetaCacheRef.current.set(activeJob.id, meta)
    setJobMetaDraft(meta)
    const nextInputs = toMaterialsInputState(meta.materials)
    materialInputsRef.current = nextInputs
    setMaterialInputs(nextInputs)
    setMetaDirty(false)
    setMetaSaving(false)
    setMetaStatusMessage(null)
    setMetaSavedAt(null)
    setCrewNotesSaving(false)
    notesPrevValueRef.current = meta.crewNotes
    setLightboxIndex(null)
    setMediaLoading(true)

    const jobIdKey = String(activeJob.id)
    let cancelled = false

    const loadMedia = async () => {
      try {
        if (cloudEnabled) {
          await syncRemoteMedia(jobIdKey).catch((error) => {
            console.warn('Failed to refresh remote media', error)
          })
        }
        const items = await listMedia(jobIdKey)
        if (cancelled) {
          return
        }
        setMediaItems((prev) => {
          if (prev.length > 0) {
            revokeMediaUrls(prev)
          }
          return items
        })
        setMediaError(null)
      } catch (error) {
        if (cancelled) {
          return
        }
        setMediaItems((prev) => {
          if (prev.length > 0) {
            revokeMediaUrls(prev)
          }
          return []
        })
        setMediaError(
          error instanceof Error
            ? error.message
            : 'Unable to load media for this job.',
        )
      } finally {
        if (!cancelled) {
          setMediaLoading(false)
        }
      }
    }

    void loadMedia()

    return () => {
      cancelled = true
    }
  }, [activeJob])

  useEffect(() => {
    if (!activeJob) {
      setCrewNotesSaving(false)
      return
    }

    if (previousJobIdRef.current !== activeJob.id) {
      previousJobIdRef.current = activeJob.id
      notesPrevValueRef.current = jobMetaDraft.crewNotes
      return
    }

    const currentNotes = jobMetaDraft.crewNotes ?? ''

    if ((notesPrevValueRef.current ?? '') === currentNotes) {
      return
    }

    if (crewNotesAutoSaveTimeoutRef.current !== null) {
      window.clearTimeout(crewNotesAutoSaveTimeoutRef.current)
    }

    setCrewNotesSaving(true)
    crewNotesAutoSaveTimeoutRef.current = window.setTimeout(() => {
      persistMetaForJob(activeJob.id, { ...jobMetaDraft, crewNotes: currentNotes }, { silent: true })
      setCrewNotesSaving(false)
      setMetaStatusMessage('Notes autosaved')
      notesPrevValueRef.current = currentNotes
      crewNotesAutoSaveTimeoutRef.current = null
    }, 800)

    return () => {
      if (crewNotesAutoSaveTimeoutRef.current !== null) {
        window.clearTimeout(crewNotesAutoSaveTimeoutRef.current)
        crewNotesAutoSaveTimeoutRef.current = null
      }
    }
  }, [activeJob, jobMetaDraft.crewNotes, persistMetaForJob])

  useEffect(() => {
    return () => {
      if (mediaItems.length > 0) {
        revokeMediaUrls(mediaItems)
      }
    }
  }, [mediaItems])

  useEffect(() => {
    return () => {
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (lightboxIndex === null) {
      if (typeof document !== 'undefined') {
        document.body.style.removeProperty('overflow')
      }
      return
    }

    if (typeof document === 'undefined') {
      return
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeLightbox()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        showNextLightbox()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        showPrevLightbox()
      }
    }

    document.addEventListener('keydown', handleKey)

    return () => {
      document.body.style.overflow = originalOverflow
      document.removeEventListener('keydown', handleKey)
    }
  }, [lightboxIndex, closeLightbox, showNextLightbox, showPrevLightbox])
  const scheduleResetMessages = () => {
    setScheduleError(null)
    setScheduleNotice(null)
  }

  const quickResetMessages = () => {
    setQuickError(null)
    setQuickNotice(null)
  }

  const addJobToBoard = async (payload: JobCore): Promise<Job> => {
    const jobId = Date.now() + Math.floor(Math.random() * 1000)
    const job: Job = { id: jobId, ...payload }
    setJobs((prev) =>
      sortJobs([
        ...prev.filter((existing) => existing.id !== jobId),
        job,
      ]),
    )
    setActiveDate(payload.date)
    return job
  }

  const handleScheduleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault()
    scheduleResetMessages()

    const payload = toJobPayload(scheduleForm)
    const validationError = validateNewJob(payload, jobs, policy)
    if (validationError) {
      setScheduleError(validationError)
      return
    }

    try {
      const createdJob = await addJobToBoard(payload)
      if (payload.meta) {
        const normalizedMeta = normalizeJobMeta(payload.meta)
        saveMeta(String(createdJob.id), normalizedMeta)
        jobMetaCacheRef.current.set(createdJob.id, normalizedMeta)
      }
      setScheduleForm(createEmptyForm({ crew: scheduleForm.crew }))
      setScheduleNotice('Job added to the board.')
    } catch (error) {
      setScheduleError(
        error instanceof Error
          ? error.message
          : 'Unable to add the job right now. Please try again.',
      )
    }
  }

  const handleQuickAddMaterialChange = useCallback(
    (key: MaterialKey) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setQuickAddForm((prev) => {
        if (prev.materials[key] === value) {
          return prev
        }
        return {
          ...prev,
          materials: {
            ...prev.materials,
            [key]: value,
          },
        }
      })
    },
    [],
  )

  const handleQuickAddMaterialBlur = useCallback(
    (key: MaterialKey) => () => {
      const { integer } = MATERIAL_FIELD_MAP[key]
      setQuickAddForm((prev) => {
        const raw = prev.materials[key]
        const sanitized = parseMaterialInput(raw, integer)
        const formatted = formatMaterialNumber(sanitized, integer)
        if (prev.materials[key] === formatted) {
          return prev
        }
        return {
          ...prev,
          materials: {
            ...prev.materials,
            [key]: formatted,
          },
        }
      })
    },
    [],
  )

  const handleQuickAddSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault()
    quickResetMessages()

    const normalizedDate = quickAddForm.date || activeDate || todayIso
    const payload = toJobPayload({ ...quickAddForm, date: normalizedDate })
    const validationError = validateNewJob(payload, jobs, policy)
    if (validationError) {
      setQuickError(validationError)
      return
    }

    try {
      const createdJob = await addJobToBoard(payload)
      if (payload.meta) {
        const normalizedMeta = normalizeJobMeta(payload.meta)
        saveMeta(String(createdJob.id), normalizedMeta)
        jobMetaCacheRef.current.set(createdJob.id, normalizedMeta)
      }
      setQuickAddForm(
        createEmptyForm({ date: normalizedDate, crew: payload.crew }),
      )
      setQuickNotice('Job added to the board.')
    } catch (error) {
      setQuickError(
        error instanceof Error
          ? error.message
          : 'Unable to add the job right now. Please try again.',
      )
    }
  }

  const handleLoadRemoteClients = async () => {
    setClientsLoading(true)
    setClientsError(null)
    try {
      const loaded = await loadClientsFromPublic()
      setClients(loaded)
    } catch (error) {
      setClientsError(
        error instanceof Error
          ? error.message
          : 'Unable to fetch clients.csv. Place the file in public/clients.csv and try again.',
      )
    } finally {
      setClientsLoading(false)
    }
  }

  const handleLocalClientFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setClientsLoading(true)
    setClientsError(null)
    try {
      const loaded = await loadClientsFromFile(file)
      setClients(loaded)
    } catch (error) {
      setClientsError(
        error instanceof Error
          ? error.message
          : 'Unable to parse the selected CSV file.',
      )
    } finally {
      setClientsLoading(false)
      event.target.value = ''
    }
  }

  const handleClientPrefill = (client: Client) => {
    quickResetMessages()
    const fallbackDate = activeDate || todayIso

    setQuickAddForm((prev) => ({
      ...prev,
      date: fallbackDate,
      crew: quickCrewChoices.includes('Crew 1') ? 'Crew 1' : prev.crew,
      client: client.name,
      address: client.address,
      neighborhood: client.neighborhood,
      zip: client.zip,
      houseTier: client.houseTier ? String(client.houseTier) : '',
      rehangPrice: client.rehangPrice ? String(client.rehangPrice) : '',
      lifetimeSpend: client.lifetimeSpend
        ? String(client.lifetimeSpend)
        : '',
      vip: client.vip,
      scope: `Rehang service for ${client.name}`,
      notes: client.notes ?? '',
    }))

    setView('board')
    setBoardTab('admin')

    requestAnimationFrame(() => {
      quickAddSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
      setTimeout(() => quickAddButtonRef.current?.focus(), 250)
    })
  }

  const handleExportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ jobs, policy }, null, 2)],
      { type: 'application/json' },
    )
    const filename = `sonl-crew-ops-${new Date()
      .toISOString()
      .slice(0, 10)}.json`
    triggerDownload(blob, filename)
  }

  const handleImportJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as {
        jobs?: unknown
        policy?: unknown
        activeDate?: unknown
      }

      if (
        !window.confirm(
          'Replace the current jobs and policy with the imported data?',
        )
      ) {
        return
      }

      const importedJobs = sanitizeJobs(parsed.jobs ?? [], [])
      if (
        Array.isArray(parsed.jobs) &&
        parsed.jobs.length > 0 &&
        importedJobs.length === 0
      ) {
        throw new Error('No valid jobs were found in the imported file.')
      }

      const importedPolicy = sanitizePolicy(
        parsed.policy ?? defaultPolicy,
        defaultPolicy,
      )

      setJobs(sortJobs(importedJobs))
      setPolicy(importedPolicy)

      const nextActive = sanitizeActiveDate(
        parsed.activeDate ?? importedJobs[0]?.date ?? '',
        importedJobs[0]?.date ?? initialActiveDate,
      )
      setActiveDate(nextActive)
      setScheduleForm((prev) => ({ ...prev, date: nextActive }))
      setQuickAddForm((prev) => ({ ...prev, date: nextActive }))

      setQuickNotice('Imported schedule data.')
      setQuickError(null)
      setScheduleError(null)
      setScheduleNotice(null)
    } catch (error) {
      console.error('Import failed', error)
      setQuickError(
        'Unable to import schedule data. Please verify the JSON structure.',
      )
    } finally {
      event.target.value = ''
    }
  }

  const handleExportCsv = () => {
    const header = [
      'Date',
      'Crew',
      'Client',
      'Address',
      'Neighborhood',
      'Zip',
      'Tier',
      'Rehang Price',
      'Notes',
      'VIP',
      'Both Crews',
    ]

    const rows = jobs.map((job) => [
      job.date,
      job.crew,
      job.client,
      job.address ?? '',
      job.neighborhood ?? '',
      job.zip ?? '',
      job.houseTier ?? '',
      job.rehangPrice ?? '',
      job.notes ?? '',
      job.vip ? 'true' : 'false',
      job.crew === 'Both Crews' ? 'true' : 'false',
    ])

    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n')

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;',
    })
    const filename = `sonl-crew-ops-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`
    triggerDownload(blob, filename)
  }

  const stripesStyleElement = <style>{stripesStyles}</style>
  const routeProgress = useMemo(() => {
    const maxJobs = policy.maxJobsPerDay || defaultPolicy.maxJobsPerDay
    if (!maxJobs || maxJobs <= 0) {
      return 0
    }
    const todaysJobs = jobs.filter((job) => job.date === activeDate)
    return Math.min(1, todaysJobs.length / maxJobs)
  }, [jobs, activeDate, policy.maxJobsPerDay])
  const hasFreshKudos = useMemo(
    () =>
      SAMPLE_KUDOS.some((entry) => {
        const timestamp = new Date(entry.timestamp).getTime()
        if (Number.isNaN(timestamp)) {
          return false
        }
        return Date.now() - timestamp < 1000 * 60 * 60 * 24 * 3
      }),
    [],
  )
  const handleViewSelect = useCallback(
    (next: View) => {
      setView(next)
      if (next === 'board') {
        setBoardTab('clients')
      }
    },
    [setBoardTab, setView],
  )

  return (
    <>
      <LayerHost />
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
        {stripesStyleElement}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-20 h-32 bg-gradient-to-b from-slate-950/90 via-slate-950/40 to-transparent"
        />

        <main
          className="relative z-10 pt-16 pb-32 sm:pb-36"
          style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="mx-auto w-full max-w-7xl px-4">
            <div className="space-y-6">
              {storageError && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {storageError}
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col gap-4 rounded-3xl border border-amber-400/20 bg-slate-950/50 p-5 shadow-[0_18px_55px_rgba(7,10,20,0.55)] backdrop-blur-xl md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-200">
                    SONL
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{user.name}</p>
                    <p className="text-xs text-amber-200/80">
                      {user.role === 'admin' ? 'Admin access' : 'Crew access'}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-slate-300 md:text-right space-y-2">
                  <div className="space-y-1">
                    <p>
                    Guardrails live: {policy.maxJobsPerDay} {jobsPerDayLabel} max · Both Crews stays exclusive
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Offline cache · {dexieAvailable ? 'IndexedDB ready' : 'Memory only'} ·{' '}
                      {STORAGE_SOURCE_LABEL[storageSource]}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                      Sync {syncStatus.status}
                      {syncStatus.queued > 0 ? ` · ${syncStatus.queued} queued` : ''}
                      {syncStatus.lastError ? ' · error' : ''}
                    </p>
                    <p className="text-[11px] text-slate-300/80">Last sync: {lastSyncLabel}</p>
                    {syncStatus.lastError && (
                      <p className="text-[11px] text-rose-300">Sync issue: {syncStatus.lastError}</p>
                    )}
                  </div>
                  {showInstallCta && (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        className="bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                        onClick={handleInstallClick}
                      >
                        Install App
                      </Button>
                      <button
                        type="button"
                        onClick={handleDismissInstall}
                        className="text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        Not now
                      </button>
                    </div>
                  )}
                  {!showInstallCta && showInstallHint && (
                    <p className="text-[11px] text-slate-400">
                      Tip: Add to Home Screen from your browser menu for the full experience.
                    </p>
                  )}
                </div>
              </motion.div>

              {view === 'route' && (
        <motion.div
          variants={fadeInVariants}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
            <Card className={`rounded-2xl ${THEME.panel}`}>
              <CardHeader>
                <CardTitle className="text-xl font-semibold text-white">Schedule a job</CardTitle>
                <CardDescription className={THEME.subtext}>
                  Keep the crews balanced and mind the December shutdown.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-4" onSubmit={handleScheduleSubmit}>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Job date
                    <Input
                      type="date"
                      value={scheduleForm.date}
                      onChange={(event) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Crew assignment
                    <select
                      className="h-10 w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-inner shadow-slate-950/40 transition focus-visible:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
                      value={scheduleForm.crew}
                      onChange={(event) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          crew: event.target.value as CrewOption,
                        }))
                      }
                    >
                      {crewOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Client
                    <Input
                      placeholder="Company or contact"
                      value={scheduleForm.client}
                      onChange={(event) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          client: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Scope
                    <Textarea
                      placeholder="Work summary for the crew"
                      value={scheduleForm.scope}
                      onChange={(event) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          scope: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Notes (optional)
                    <Textarea
                      rows={3}
                      placeholder="Site notes, staging info, or equipment needs"
                      value={scheduleForm.notes}
                      onChange={(event) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </label>

                  {scheduleError && (
                    <p className="rounded-md border border-rose-900/60 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
                      {scheduleError}
                    </p>
                  )}

                  {scheduleNotice && (
                    <p className="rounded-md border border-amber-900/50 bg-amber-900/15 px-3 py-2 text-sm text-amber-200">
                      {scheduleNotice}
                    </p>
                  )}

                  <Button type="submit" className={`${THEME.cta} h-11 rounded-full text-sm font-semibold`}>
                    Schedule job
                  </Button>
                </form>
              </CardContent>
              <CardFooter className={`text-xs ${THEME.subtext}`}>
                Active date: {activeDate || 'Not set'} · Suspended: {blockedClientSummary}
              </CardFooter>
            </Card>

            <div className="space-y-6">
              <motion.div
                key={activeJob?.id ?? 'empty'}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="rounded-3xl border border-slate-800/60 bg-slate-950/30 p-6 shadow-inner shadow-slate-950/40"
              >
                <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
                  <Card className={`rounded-2xl ${THEME.panel}`}>
                    <CardHeader className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
                            <span>{activeJob?.crew ?? 'Select a job'}</span>
                            {activeJob && (
                              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">
                                {activeJob.date}
                              </span>
                            )}
                          </div>
                          <h3 className="text-2xl font-semibold text-white">
                            {activeJob?.client ?? 'No job selected'}
                          </h3>
                          {activeJob?.address && (
                            <p className={`text-sm ${THEME.subtext}`}>
                              {activeJob.address}
                              {activeJob.neighborhood ? ` · ${activeJob.neighborhood}` : ''}
                              {activeJob.zip ? ` · ${activeJob.zip}` : ''}
                            </p>
                          )}
                          {jobMetaDraft.contactPhone && (
                            <a
                              href={`tel:${jobMetaDraft.contactPhone.replace(/[^+\d]/g, '')}`}
                              className="inline-flex items-center gap-2 text-sm text-amber-200 transition hover:text-amber-100"
                            >
                              <span aria-hidden>📞</span>
                              <span>{jobMetaDraft.contactPhone}</span>
                            </a>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-3">
                          <StatusBadge status={jobMetaDraft.status} variant="xl" />
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              className="h-9 rounded-full bg-amber-500 px-4 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
                              onClick={handleStartJob}
                              disabled={
                                jobMetaDraft.status === 'In progress' ||
                                jobMetaDraft.status === 'Done'
                              }
                            >
                              Start
                            </Button>
                            <Button
                              type="button"
                              className="h-9 rounded-full border border-slate-700 bg-slate-800 px-4 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
                              onClick={handleStopJob}
                              disabled={jobMetaDraft.status === 'Done'}
                            >
                              Wrap
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Scope
                        </p>
                        <p className="mt-1 text-sm text-slate-200">{activeJob?.scope ?? 'Select a job to review scope.'}</p>
                        {activeJob?.notes && (
                          <p className="mt-2 text-xs text-slate-400">{activeJob.notes}</p>
                        )}
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Roof type
                          <select
                            className="h-10 w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-inner shadow-slate-950/40 transition focus-visible:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
                            value={jobMetaDraft.roofType ?? ''}
                            onChange={handleRoofTypeChange}
                          >
                            <option value="">Select</option>
                            {roofTypeOptions.map((option) => (
                              <option key={option} value={option}>
                                {titleCase(option)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Color pattern
                          <Input
                            placeholder="W-R-W-R"
                            value={jobMetaDraft.colorPattern ?? ''}
                            onChange={handleMetaTextChange('colorPattern')}
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Power notes
                          <Input
                            placeholder="GFCI left of garage"
                            value={jobMetaDraft.powerNotes ?? ''}
                            onChange={handleMetaTextChange('powerNotes')}
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Hazards
                          <Input
                            placeholder="Dogs, icy walk"
                            value={jobMetaDraft.hazards ?? ''}
                            onChange={handleMetaTextChange('hazards')}
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Gate code
                          <Input
                            placeholder="####"
                            value={jobMetaDraft.gateCode ?? ''}
                            onChange={handleMetaTextChange('gateCode')}
                          />
                        </label>
                        <label className="md:col-span-2 flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Contact phone
                          <Input
                            placeholder="Crew point of contact"
                            value={jobMetaDraft.contactPhone ?? ''}
                            onChange={handleMetaTextChange('contactPhone')}
                          />
                        </label>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Status
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {statusOptions.map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => handleStatusChange(status)}
                              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                jobMetaDraft.status === status
                                  ? 'bg-amber-500 text-slate-900'
                                  : `bg-slate-800 ${THEME.subtext} hover:bg-slate-700`
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                        {jobMetaDraft.finishedAt && (
                          <p className={`mt-1 text-xs ${THEME.subtext}`}>
                            Completed{' '}
                            {new Date(jobMetaDraft.finishedAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Materials
                        </p>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          {materialFields.map(({ key, label, step, integer }) => (
                            <label
                              key={key}
                              className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                            >
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                {label}
                              </span>
                              <Input
                                type="number"
                                inputMode={integer ? 'numeric' : 'decimal'}
                                min="0"
                                step={step}
                                value={materialInputs[key]}
                                onChange={handleMaterialInputChange(key)}
                                onBlur={handleMaterialInputBlur(key)}
                                className="h-11 rounded-full border border-slate-700 bg-slate-950/60 px-4 text-center text-base font-semibold text-white placeholder:text-slate-500 focus-visible:border-amber-500 focus-visible:ring-amber-500/60"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className={`flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide ${THEME.subtext}`}>
                          Crew notes
                          <Textarea
                            rows={4}
                            placeholder="Install reminders, pay adjustments, or completion notes"
                            value={jobMetaDraft.crewNotes ?? ''}
                            onChange={handleCrewNotesChange}
                            className="resize-none"
                          />
                        </label>
                        <div className={`mt-1 flex flex-wrap items-center justify-between gap-3 text-xs ${THEME.subtext}`}>
                          <span>
                            {crewNotesSaving
                              ? 'Autosaving…'
                              : metaStatusMessage ??
                                (metaSavedAt
                                  ? `Saved ${new Date(metaSavedAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}`
                                  : 'Notes autosave after you pause typing.')}
                          </span>
                          {metaDirty && <span className="text-amber-300">Unsaved changes</span>}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                        <div className={`text-xs ${THEME.subtext}`}>
                          Dial in install info so crews can run fast and safe.
                        </div>
                        <Button
                          type="button"
                          onClick={handleMetaSaveClick}
                          disabled={!metaDirty || metaSaving}
                          className={`${THEME.cta} rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60`}
                        >
                          {metaSaving ? 'Saving…' : 'Save install info'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={`rounded-2xl ${THEME.panel}`}>
                    <CardHeader className="space-y-2">
                      <div className="flex items-center justify-between">
                        <CardTitle>Media ({mediaItems.length})</CardTitle>
                        {mediaLoading && (
                          <span className={`text-xs ${THEME.subtext}`}>Syncing…</span>
                        )}
                      </div>
                      <CardDescription className={THEME.subtext}>
                        Document installs, problem spots, and holiday glow for future crews.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <label className="block">
                        <span className={`text-xs font-semibold uppercase tracking-wide ${THEME.subtext}`}>
                          Upload files
                        </span>
                        <Input
                          type="file"
                          multiple
                          accept="image/*,video/*"
                          className="mt-2 cursor-pointer bg-slate-900/60 file:mr-4 file:rounded-md file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-400"
                          onChange={(event) => {
                            void handleMediaSelection(event.target.files)
                            event.target.value = ''
                          }}
                        />
                      </label>
                      {mediaError && (
                        <p className="rounded-lg border border-rose-900/60 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
                          {mediaError}
                        </p>
                      )}
                      {needsMigration && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span>
                              {unsyncedMediaCount}{' '}
                              {unsyncedMediaCount === 1
                                ? 'media item'
                                : 'media items'}{' '}
                              queued for sync.
                            </span>
                            <Button
                              type="button"
                              className={`${THEME.cta} rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-70`}
                              onClick={() => {
                                void handleSyncMedia()
                              }}
                              disabled={mediaSyncing || mediaLoading}
                            >
                              {mediaSyncing ? 'Syncing…' : 'Sync now'}
                            </Button>
                          </div>
                        </div>
                      )}
                      {mediaItems.length === 0 ? (
                        <div className={`rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-sm ${THEME.subtext}`}>
                          Drop install photos or scout videos to build up the job history.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {mediaItems.map((item, index) => {
                            const preview = item.previewUrl ?? item.remoteUrl ?? item.localUrl ?? ''
                            const isImage = item.type?.startsWith('image/')
                            const isVideo = item.type?.startsWith('video/')
                            const statusLabel =
                              item.status === 'synced'
                                ? 'Synced'
                                : item.status === 'uploading'
                                  ? 'Uploading…'
                                  : item.status === 'queued'
                                    ? 'Queued'
                                    : item.status === 'error'
                                      ? 'Error'
                                      : 'Local'
                            const statusTone =
                              item.status === 'synced'
                                ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-500/40'
                                : item.status === 'error'
                                  ? 'bg-rose-500/20 text-rose-100 border border-rose-500/40'
                                  : 'bg-amber-500/20 text-amber-100 border border-amber-500/40'

                            return (
                              <div
                                key={item.id}
                                className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"
                              >
                                {isImage && preview ? (
                                  <button
                                    type="button"
                                    onClick={() => openLightbox(index)}
                                    className="block w-full"
                                  >
                                    <img
                                      src={preview}
                                      alt={`${activeJob?.client ?? 'Job'} media ${index + 1}`}
                                      className="h-36 w-full object-cover transition duration-200 group-hover:scale-105"
                                    />
                                  </button>
                                ) : isVideo && preview ? (
                                  <div className="relative">
                                    <video
                                      src={preview}
                                      className="h-36 w-full object-cover"
                                      controls
                                      playsInline
                                    />
                                    <button
                                      type="button"
                                      onClick={() => openLightbox(index)}
                                      className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-200 opacity-0 transition group-hover:opacity-100"
                                    >
                                      Expand
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex h-36 items-center justify-center bg-slate-900/40 text-xs text-slate-400">
                                    No preview
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                                  <div className={`truncate ${THEME.subtext}`}>
                                    {item.name || 'Untitled'}
                                  </div>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDeleteMedia(item.id)
                                  }}
                                  className="absolute right-2 bottom-2 rounded-full bg-slate-900/80 p-1.5 text-xs text-slate-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-600/90"
                                  aria-label="Delete media"
                                >
                                  🗑
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
      {view === 'board' && (
        <motion.div
          variants={fadeInVariants}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <div className={`rounded-2xl ${THEME.panel} flex flex-wrap items-center justify-between gap-4 p-6`}>
            <div>
              <h2 className="text-xl font-semibold text-white">Operations board</h2>
              <p className="text-sm text-slate-400">Manage clients and push admin updates.</p>
            </div>
            <div className="flex gap-2">
              {(
                [
                  { key: 'clients' as BoardTab, label: 'Clients' },
                  { key: 'admin' as BoardTab, label: 'Quick Add' },
                ]
              ).map((item) => (
                <button
                  key={item.key}
                  onClick={() => setBoardTab(item.key)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    boardTab === item.key
                      ? 'border-amber-400 bg-amber-500/10 text-amber-200'
                      : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-amber-400/40 hover:bg-slate-900/80'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {boardTab === 'clients' ? (
            <Card className={`rounded-2xl ${THEME.panel}`}>
              <CardHeader>
                <CardTitle>Clients list</CardTitle>
                <CardDescription className={THEME.subtext}>
                  Load customers from CSV to tee up quick scheduling. VIPs get a ⚡ badge.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={handleLoadRemoteClients}
                    disabled={clientsLoading}
                    className={`${THEME.cta} rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60`}
                  >
                    {clientsLoading ? 'Loading…' : 'Load from CSV'}
                  </Button>
                  <label className={`text-sm ${THEME.subtext}`}>
                    Import local CSV
                    <Input
                      ref={clientFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="mt-1 cursor-pointer bg-slate-900/60 file:mr-4 file:rounded-md file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-400"
                      onChange={handleLocalClientFile}
                    />
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    <Input
                      placeholder="Search clients"
                      value={clientSearch}
                      onChange={(event) => setClientSearch(event.target.value)}
                    />
                  </div>
                </div>

                {clientsError && (
                  <p className="rounded-md border border-rose-900/60 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
                    {clientsError}
                  </p>
                )}

                {!clientsLoading && clients.length === 0 ? (
                  <div className={`rounded-lg border border-dashed border-slate-800 px-4 py-6 text-sm ${THEME.subtext}`}>
                    <p className="font-semibold text-white/90">No client data yet.</p>
                    <p className="mt-2">
                      Place a <code className="rounded bg-slate-800 px-1">clients.csv</code>{' '}
                      file in <code className="rounded bg-slate-800 px-1">public/</code> with the columns: Client Name,
                      Address, Neighborhood, Zip, Rehang Price, House Tier, Lifetime Spend, Referral, Notes.
                    </p>
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div className={`rounded-lg border border-dashed border-slate-800 px-4 py-6 text-sm ${THEME.subtext}`}>
                    No clients match your search. Clear the filter to see all records.
                  </div>
                ) : (
                  <>
                    <div className={`flex flex-wrap items-center justify-between text-xs ${THEME.subtext}`}>
                      <span>{filteredClients.length} clients</span>
                      <span>
                        Page {currentPage} of {totalPages}
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                        <thead className={`bg-slate-950/70 text-xs uppercase tracking-wide ${THEME.subtext}`}>
                          <tr>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Neighborhood</th>
                            <th className="px-4 py-3 font-medium">Zip</th>
                            <th className="px-4 py-3 font-medium">Tier</th>
                            <th className="px-4 py-3 font-medium">Rehang</th>
                            <th className="px-4 py-3 font-medium">Lifetime</th>
                            <th className="px-4 py-3 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {paginatedClients.map((client) => (
                            <tr key={`${client.name}-${client.address}`}>
                              <td className="px-4 py-3">
                                <div className="flex flex-col">
                                  <span className="flex items-center gap-1 font-semibold text-white">
                                    {client.vip && <span aria-hidden>⚡</span>}
                                    {client.name}
                                  </span>
                                  <span className={`text-xs ${THEME.subtext}`}>
                                    {client.address}
                                  </span>
                                </div>
                              </td>
                              <td className={`px-4 py-3 text-sm ${THEME.subtext}`}>
                                {client.neighborhood || '—'}
                              </td>
                              <td className={`px-4 py-3 text-sm ${THEME.subtext}`}>
                                {client.zip || '—'}
                              </td>
                              <td className={`px-4 py-3 text-sm ${THEME.subtext}`}>
                                {client.houseTier ?? '—'}
                              </td>
                              <td className={`px-4 py-3 text-sm ${THEME.subtext}`}>
                                {client.rehangPrice
                                  ? moneyFormatter.format(client.rehangPrice)
                                  : '—'}
                              </td>
                              <td className={`px-4 py-3 text-sm ${THEME.subtext}`}>
                                {client.lifetimeSpend
                                  ? moneyFormatter.format(client.lifetimeSpend)
                                  : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    className={`${THEME.cta} rounded-full px-4 py-2 text-sm font-semibold`}
                                    onClick={() => handleClientPrefill(client)}
                                  >
                                    Create job
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between">
                      <Button
                        type="button"
                        className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                        disabled={currentPage === 1}
                        onClick={() => setClientPage((page) => Math.max(1, page - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        type="button"
                        className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                        disabled={currentPage === totalPages}
                        onClick={() => setClientPage((page) => Math.min(totalPages, page + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card ref={quickAddSectionRef} className={`rounded-2xl ${THEME.panel}`}>
              <CardHeader>
                <CardTitle>Quick add job</CardTitle>
                <CardDescription className={THEME.subtext}>
                  Prefilled via the Clients tab. Review details, then push to the board.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleExportJson}
                    className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
                  >
                    Export JSON
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
                    onClick={() => adminImportInputRef.current?.click()}
                  >
                    Import JSON
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
                    onClick={handleExportCsv}
                  >
                    Export CSV
                  </Button>
                  <input
                    ref={adminImportInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportJson}
                  />
                </div>

                <form className="grid gap-4 md:grid-cols-2" onSubmit={handleQuickAddSubmit}>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200 md:col-span-1">
                    Job date
                    <Input
                      type="date"
                      value={quickAddForm.date}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200 md:col-span-1">
                    Crew
                    <select
                      className="h-10 w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-inner shadow-slate-950/40 transition focus-visible:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
                      value={quickAddForm.crew}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          crew: event.target.value,
                        }))
                      }
                    >
                      {quickCrewChoices.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200 md:col-span-2">
                    Client
                    <Input
                      value={quickAddForm.client}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          client: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200 md:col-span-2">
                    Scope
                    <Textarea
                      rows={3}
                      value={quickAddForm.scope}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          scope: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Address
                    <Input
                      value={quickAddForm.address}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          address: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Neighborhood
                    <Input
                      value={quickAddForm.neighborhood}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          neighborhood: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Zip
                    <Input
                      value={quickAddForm.zip}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          zip: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    House tier
                    <Input
                      type="number"
                      min="0"
                      value={quickAddForm.houseTier}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          houseTier: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Rehang price
                    <Input
                      type="number"
                      min="0"
                      value={quickAddForm.rehangPrice}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          rehangPrice: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Lifetime spend
                    <Input
                      type="number"
                      min="0"
                      value={quickAddForm.lifetimeSpend}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          lifetimeSpend: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="md:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Materials
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {materialFields.map(({ key, label, step, integer }) => (
                        <label
                          key={key}
                          className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                        >
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            {label}
                          </span>
                          <Input
                            type="number"
                            inputMode={integer ? 'numeric' : 'decimal'}
                            min="0"
                            step={step}
                            value={quickAddForm.materials[key]}
                            onChange={handleQuickAddMaterialChange(key)}
                            onBlur={handleQuickAddMaterialBlur(key)}
                            className="h-11 rounded-full border border-slate-700 bg-slate-950/60 px-4 text-center text-base font-semibold text-white placeholder:text-slate-500 focus-visible:border-amber-500 focus-visible:ring-amber-500/60"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border border-slate-700 bg-slate-900 text-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                      checked={quickAddForm.vip}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          vip: event.target.checked,
                        }))
                      }
                    />
                    VIP client
                  </label>
                  <label className="md:col-span-2 flex flex-col gap-2 text-sm font-medium text-slate-200">
                    Notes (optional)
                    <Textarea
                      rows={3}
                      value={quickAddForm.notes}
                      onChange={(event) =>
                        setQuickAddForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </label>

                  {quickError && (
                    <p className="md:col-span-2 rounded-md border border-rose-900/60 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
                      {quickError}
                    </p>
                  )}

                  {quickNotice && (
                    <p className="md:col-span-2 rounded-md border border-amber-900/50 bg-amber-900/15 px-3 py-2 text-sm text-amber-200">
                      {quickNotice}
                    </p>
                  )}

                  <div className="md:col-span-2 flex justify-end">
                    <Button ref={quickAddButtonRef} type="submit" className={`${THEME.cta} h-11 rounded-full px-6 text-sm font-semibold`}>
                      Add job
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}
      {view === 'docs' && (
        <motion.div
          variants={fadeInVariants}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.3 }}
        >
          <Card className={`rounded-2xl ${THEME.panel}`}>
            <CardHeader>
              <CardTitle>Playbook</CardTitle>
              <CardDescription className={THEME.subtext}>
                Guardrails and reminders for the seasonal crew dispatch.
              </CardDescription>
            </CardHeader>
            <CardContent className={`space-y-3 text-sm ${THEME.subtext}`}>
              <p>
                • {policy.maxJobsPerDay} {jobsPerDayLabel} maximum per calendar day. Use the Both Crews slot when the full team is required and leave the rest of the day open.
              </p>
              <p>
                • Keep the install calendar balanced—use the Both Crews slot when the full team is required and leave the rest of the day open.
              </p>
              <p>
                • Suspended clients ({blockedClientSummary}) remain off the board until finance clears them.
              </p>
              <p>
                • VIP neighborhoods: Country Ridge, Cherry Hills, Patriot Sub. Flagged automatically when loaded from CSV.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}
      {view === 'hq' && <CrewHQ />}
      {view === 'profile' && (
        <ProfileScreen
          user={user}
          onLogout={onLogout}
          syncStatus={syncStatus}
          onSyncNow={syncNow}
        />
      )}
            </div>
          </div>
        </main>
        <BottomNav
          activeView={view}
          onSelect={handleViewSelect}
          routeProgress={routeProgress}
          hasCrewBadge={hasFreshKudos}
        />
      </div>
      <AnimatePresence>
        {currentLightboxItem && (
          <motion.div
            key={currentLightboxItem.id}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeLightbox()
              }
            }}
          >
            <motion.div
              className="relative w-[min(90vw,900px)] max-w-4xl"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <button
                type="button"
                onClick={closeLightbox}
                className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-sm font-semibold text-white hover:bg-black/90"
              >
                Close
              </button>
              {currentLightboxIsImage && currentLightboxPreview ? (
                <img
                  src={currentLightboxPreview}
                  alt={currentLightboxItem?.name ?? activeJob?.client ?? 'Job media'}
                  className="max-h-[80vh] w-full rounded-2xl object-contain"
                />
              ) : currentLightboxPreview ? (
                <video
                  src={currentLightboxPreview}
                  controls
                  autoPlay
                  className="max-h-[80vh] w-full rounded-2xl bg-black"
                />
              ) : (
                <div className="flex h-[60vh] items-center justify-center rounded-2xl bg-slate-900 text-slate-300">
                  Media preview unavailable.
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-200">
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {activeJob?.client ?? 'Media asset'}
                  </span>
                  {currentLightboxItem.name && (
                    <span className={`text-xs ${THEME.subtext}`}>
                      {currentLightboxItem.name}
                    </span>
                  )}
                </div>
                {mediaItems.length > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={showPrevLightbox}
                      className="rounded-full border border-slate-500 px-3 py-1 text-xs uppercase tracking-wide text-slate-200 transition hover:border-amber-400 hover:text-amber-200"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={showNextLightbox}
                      className="rounded-full border border-slate-500 px-3 py-1 text-xs uppercase tracking-wide text-slate-200 transition hover:border-amber-400 hover:text-amber-200"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

type LoginPopoverProps = {
  crewNames: string[]
  selectedName: string
  onSelectName: (value: string) => void
  pin: string
  onPinChange: (value: string) => void
  error: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pinRef: RefObject<HTMLInputElement>
}

type StatusBadgeProps = {
  status?: JobMeta['status']
  variant?: 'default' | 'xl'
}

function StatusBadge({ status = 'Not started', variant = 'default' }: StatusBadgeProps) {
  const tone =
    status === 'Done'
      ? {
          bg: 'bg-amber-500/20',
          text: 'text-amber-200',
          ring: 'ring-amber-500/40',
        }
      : status === 'In progress'
        ? {
            bg: 'bg-amber-400/20',
            text: 'text-amber-100',
            ring: 'ring-amber-400/40',
          }
        : {
            bg: 'bg-slate-800/70',
            text: 'text-slate-200',
            ring: 'ring-slate-600/40',
          }

  const base =
    variant === 'xl'
      ? 'px-4 py-1.5 text-sm font-semibold uppercase tracking-wide'
      : 'px-3 py-1 text-xs font-semibold uppercase tracking-wide'

  return (
    <span
      className={`${base} ${tone.bg} ${tone.text} rounded-full ring-1 ring-inset ${tone.ring}`}
    >
      {status ?? 'Not started'}
    </span>
  )
}

function LoginPopover({
  crewNames,
  selectedName,
  onSelectName,
  pin,
  onPinChange,
  error,
  onSubmit,
  pinRef,
}: LoginPopoverProps) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <label className="flex flex-col gap-2 text-sm font-medium text-white/90">
        Crew identity
        <select
          value={selectedName}
          onChange={(event) => onSelectName(event.target.value)}
          className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-white shadow-inner shadow-black/20 transition focus-visible:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
        >
          {crewNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium text-white/90">
        PIN
        <input
          ref={pinRef}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(event) => onPinChange(event.target.value)}
          className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-base tracking-[0.35em] text-white shadow-inner shadow-black/40 transition focus-visible:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
        />
      </label>
      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className={`${THEME.cta} h-12 w-full text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40`}
      >
        Enter Ops
      </Button>
    </form>
  )
}

function LoginGate({
  pin,
  setPin,
  onLogin,
  defaultName = 'Luke',
}: {
  pin: string
  setPin: (v: string) => void
  onLogin: (name: string, pin: string) => boolean
  defaultName?: string
}) {
  const [name, setName] = React.useState(defaultName)
  const crewNames = Object.keys(CREW_PINS)
  const [status, setStatus] = React.useState<'idle' | 'submitting' | 'error' | 'success'>('idle')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') {
      return
    }
    setStatus('submitting')
    setErrorMessage(null)
    const ok = onLogin(name, pin)
    if (ok) {
      setStatus('success')
    } else {
      setStatus('error')
      setErrorMessage('Incorrect PIN. Check with dispatch and try again.')
    }
  }

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[80]">
      {/* full-bleed background */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-center bg-cover"
        style={{ backgroundImage: `url(${LOGIN_BG})` }}
      />
      <div aria-hidden className="absolute inset-0 bg-black/55" />
      {/* centered card */}
      <div className="relative z-10 min-h-full flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 36, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="w-full max-w-md overflow-hidden rounded-[28px] border border-amber-400/25 bg-white/10 p-7 text-white shadow-[0_30px_120px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
        >
          <div className="relative mb-6 flex items-center gap-3">
            <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.4em] text-amber-200">
              SONL
            </span>
            <div className="text-sm text-white/80">
              <span className="font-semibold text-white">Crew Ops Portal</span>
              <p className="text-xs">Route control &amp; board dispatch</p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={submit}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="text-amber-100/80">Crew identity</span>
              <motion.div
                animate={{ borderColor: status === 'error' ? 'rgba(248,113,113,0.45)' : 'rgba(148,163,184,0.3)' }}
                className="relative rounded-2xl border bg-white/5"
              >
                <select
                  className="h-11 w-full appearance-none rounded-2xl bg-transparent px-4 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (status === 'error') {
                      setStatus('idle')
                      setErrorMessage(null)
                    }
                  }}
                >
                  {crewNames.map((n) => (
                    <option className="bg-slate-900 text-slate-200" key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-amber-200/80">
                  ⇩
                </span>
              </motion.div>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="text-amber-100/80">PIN</span>
              <motion.div
                animate={{ borderColor: status === 'error' ? 'rgba(248,113,113,0.45)' : 'rgba(148,163,184,0.3)' }}
                className="relative rounded-2xl border bg-white/5"
              >
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-11 w-full rounded-2xl bg-transparent px-4 text-sm text-white outline-none caret-amber-200 transition focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value)
                    if (status === 'error') {
                      setStatus('idle')
                      setErrorMessage(null)
                    }
                  }}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-amber-200/80">
                  ●●●●
                </span>
              </motion.div>
            </label>

            {errorMessage && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-100"
              >
                {errorMessage}
              </motion.p>
            )}

            <motion.button
              type="submit"
              className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-full bg-amber-500 text-sm font-semibold text-slate-900 shadow-[0_18px_45px_rgba(245,158,11,0.45)] transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-70"
              whileTap={{ scale: status === 'success' ? 1 : 0.96 }}
              disabled={status === 'submitting' || status === 'success'}
            >
              <motion.span
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                initial={{ x: '-100%' }}
                animate={{ x: status === 'success' ? '120%' : '-100%' }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
              <span className={`transition ${status === 'success' ? 'opacity-0' : 'opacity-100'}`}>
                {status === 'submitting' ? 'Checking…' : 'Enter Ops'}
              </span>
              {status === 'success' && (
                <motion.span
                  key="login-check"
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute inset-0 flex items-center justify-center text-lg text-slate-900"
                >
                  ✓
                </motion.span>
              )}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </div>,
    document.body,
  )
}

function LoginShell({
  pin,
  setPin,
  onLogin,
}: {
  pin: string
  setPin: (value: string) => void
  onLogin: (name: string, pin: string) => boolean
}) {
  const crewNames = useMemo(() => Object.keys(CREW_PINS), [])
  const gateDefault = crewNames[0] || 'Luke'

  return (
    <>
      <LayerHost />
      <LoginGate pin={pin} setPin={setPin} onLogin={onLogin} defaultName={gateDefault} />
    </>
  )
}

function LayerHost() {
  return (
    <>
      {ReactDOM.createPortal(
        <div id="layer-overlay" className="pointer-events-none fixed inset-0 z-[40]" />,
        document.body,
      )}
      {ReactDOM.createPortal(
        <div id="layer-modal" className="pointer-events-none fixed inset-0 z-[50]" />,
        document.body,
      )}
      {ReactDOM.createPortal(
        <div id="layer-toast" className="pointer-events-none fixed inset-0 z-[60]" />,
        document.body,
      )}
      {ReactDOM.createPortal(
        <div id="layer-lightbox" className="pointer-events-none fixed inset-0 z-[70]" />,
        document.body,
      )}
    </>
  )
}

type BottomNavProps = {
  activeView: View
  onSelect: (view: View) => void
  routeProgress: number
  hasCrewBadge: boolean
}

function BottomNav({ activeView, onSelect, routeProgress, hasCrewBadge }: BottomNavProps) {
  const navItems: { key: View; label: string; icon: LucideIcon; badge?: boolean; showProgress?: boolean }[] =
    [
      { key: 'route', label: 'Route', icon: MapIcon, showProgress: true },
      { key: 'board', label: 'Board', icon: LayoutDashboard },
      { key: 'hq', label: 'Crew HQ', icon: Users, badge: hasCrewBadge },
      { key: 'docs', label: 'Docs', icon: FileText },
      { key: 'profile', label: 'Profile', icon: UserRound },
    ]
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const direction = event.key === 'ArrowRight' ? 1 : -1
        const total = navItems.length
        const nextIndex = (index + direction + total) % total
        buttonRefs.current[nextIndex]?.focus()
      }
    },
    [navItems.length],
  )

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40" aria-label="Primary navigation">
      <div
        className="mx-auto w-full max-w-3xl px-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <div className="relative overflow-hidden rounded-[28px] border border-slate-800/70 bg-slate-950/85 shadow-[0_32px_90px_rgba(5,8,18,0.9)] backdrop-blur-2xl">
          <LayoutGroup>
            <div className="grid grid-cols-5 gap-1 px-2 py-2" role="tablist">
              {navItems.map((item, index) => {
                const isActive = activeView === item.key
                const Icon = item.icon
                return (
                  <motion.button
                    key={item.key}
                    type="button"
                    onClick={() => onSelect(item.key)}
                    whileTap={{ scale: 0.94 }}
                    ref={(node) => {
                      buttonRefs.current[index] = node
                    }}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    className="group relative flex min-h-[52px] flex-col items-center justify-center gap-2 rounded-3xl px-3 py-3 text-base font-bold text-slate-100 transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 focus-visible:ring-offset-0"
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="pointer-events-none absolute inset-0 rounded-3xl border border-amber-300/70 bg-amber-50/90 shadow-[0_14px_32px_rgba(245,158,11,0.35)] before:absolute before:inset-[2px] before:rounded-[inherit] before:bg-gradient-to-t before:from-amber-200/25 before:via-amber-50/10 before:to-transparent before:content-['']"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    )}
                    <motion.div
                      animate={{ scale: isActive ? 1.08 : 1 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                      className={`relative flex h-10 w-10 items-center justify-center rounded-[18px] transition-all duration-200 ${
                        isActive
                          ? 'text-amber-200 opacity-100 drop-shadow-[0_6px_12px_rgba(245,158,11,0.45)]'
                          : 'text-slate-200 opacity-80 group-hover:opacity-95 group-focus-visible:opacity-95'
                      }`}
                    >
                      <Icon
                        className="h-5 w-5 transition-transform duration-200 group-hover:scale-[1.08] group-focus-visible:scale-[1.08] md:h-[22px] md:w-[22px]"
                        aria-hidden="true"
                      />
                      {item.badge && (
                        <motion.span
                          layoutId={`${item.key}-badge`}
                          className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-amber-200/80 ring-offset-1 ring-offset-slate-900 shadow-[0_0_14px_rgba(245,158,11,0.9)]"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                        />
                      )}
                      {item.showProgress && routeProgress > 0 && (
                        <motion.span
                          className="absolute -bottom-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-amber-400/70"
                          style={{ originX: 0.5 }}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: Math.min(Math.max(routeProgress, 0.15), 1) }}
                          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                        />
                      )}
                    </motion.div>
                    <span
                      className={`relative mt-1 hidden w-full truncate text-center text-[0.95rem] transition-all duration-200 ease-out md:text-[1.05rem] ${
                        isActive
                          ? 'font-extrabold text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]'
                          : 'font-semibold tracking-wide text-slate-100/85 group-hover:text-slate-100 group-focus-visible:text-slate-100'
                      } min-[420px]:block`}
                    >
                      {item.label}
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </LayoutGroup>
        </div>
      </div>
    </nav>
  )
}

function CrewHQ() {
  const [category, setCategory] = useState<LeaderboardCategory>('bonus')
  const [kudosEntries, setKudosEntries] = useState(() =>
    SAMPLE_KUDOS.map((entry) => ({
      ...entry,
      reactions: { ...entry.reactions },
    })),
  )
  const [floatingReactions, setFloatingReactions] = useState<
    { id: number; kudoId: string; emoji: ReactionEmoji }[]
  >([])

  const getStatValue = useCallback(
    (member: CrewMember) => {
      switch (category) {
        case 'bonus':
          return member.stats.efficiencyBonuses
        case 'speed':
          return member.stats.averageInstallTime
        case 'quality':
          return member.stats.totalKudos
        default:
          return 0
      }
    },
    [category],
  )

  const sortedMembers = useMemo(() => {
    const members = [...SAMPLE_CREW_MEMBERS]
    members.sort((a, b) => {
      const aVal = getStatValue(a)
      const bVal = getStatValue(b)
      if (category === 'speed') {
        return aVal - bVal
      }
      return bVal - aVal
    })
    return members
  }, [category, getStatValue])

  const podium = sortedMembers.slice(0, 3)
  const leaderboardRest = sortedMembers.slice(3)
  const topValue = podium.length ? getStatValue(podium[0]) : 0

  const categoryMeta: Record<LeaderboardCategory, { label: string; description: string }> = {
    bonus: { label: 'Bonus Kings', description: 'Highest efficiency bonuses earned YTD' },
    speed: { label: 'Speed Demons', description: 'Fastest average install time (lower is better)' },
    quality: { label: 'Quality Captains', description: 'Most kudos received from clients' },
  }

  const formatStat = (value: number) => {
    if (category === 'speed') {
      return `${value.toFixed(1)}h`
    }
    return value.toString()
  }

  const sortedKudos = useMemo(
    () =>
      [...kudosEntries].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [kudosEntries],
  )

  const handleReact = (kudoId: string, emoji: ReactionEmoji) => {
    setKudosEntries((prev) =>
      prev.map((entry) =>
        entry.id === kudoId
          ? {
              ...entry,
              reactions: {
                ...entry.reactions,
                [emoji]: (entry.reactions[emoji] ?? 0) + 1,
              },
            }
          : entry,
      ),
    )

    const id = Date.now() + Math.random()
    setFloatingReactions((prev) => [...prev, { id, kudoId, emoji }])
    window.setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((item) => item.id !== id))
    }, 700)
  }

  const progressRatio = (value: number) => {
    if (!topValue) {
      return 0
    }
    if (category === 'speed') {
      if (value === 0) {
        return 1
      }
      return Math.min(1, Math.max(0.05, topValue / value))
    }
    return Math.min(1, Math.max(0.05, value / topValue))
  }

  const reactionEmojis: ReactionEmoji[] = ['🔥', '💡', '💪']

  return (
    <div className="space-y-6 pb-24">
      <section className={`space-y-6 ${THEME.panel} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Crew leaderboard</h2>
            <p className="text-sm text-slate-400">See which crews are leading the charge.</p>
          </div>
          <div className="flex gap-2">
            {(
              [
                { key: 'bonus', label: 'Bonus Kings' },
                { key: 'speed', label: 'Speed Demons' },
                { key: 'quality', label: 'Quality Captains' },
              ] as { key: LeaderboardCategory; label: string }[]
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setCategory(item.key)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  category === item.key
                    ? 'border-amber-400 bg-amber-500/10 text-amber-200'
                    : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-amber-400/40 hover:bg-slate-900/80'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="text-lg font-semibold text-white">{categoryMeta[category].label}</h3>
              <p className="text-sm text-slate-400">{categoryMeta[category].description}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {podium.map((member, index) => {
                const value = getStatValue(member)
                const podiumStyles = [
                  'from-amber-500/50 via-amber-400/30 to-amber-500/10 border-amber-400',
                  'from-slate-500/40 via-slate-600/30 to-slate-700/20 border-slate-500',
                  'from-orange-500/40 via-orange-400/30 to-orange-300/20 border-orange-400',
                ]
                const gradients = podiumStyles[index] ?? podiumStyles[podiumStyles.length - 1]
                const placeLabel = ['1st', '2nd', '3rd'][index] ?? `${index + 1}th`
                return (
                  <motion.div
                    key={member.id}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    transition={{ duration: 0.35, delay: index * 0.05 }}
                    className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${gradients} p-5 shadow-lg`}
                  >
                    <span className="text-sm font-semibold uppercase tracking-wide text-white/80">
                      {placeLabel}
                    </span>
                    <h4 className="mt-2 text-xl font-semibold text-white">{member.name}</h4>
                    <p className="text-sm text-white/70">{member.crew}</p>
                    <div className="mt-6">
                      <p className="text-xs uppercase tracking-wide text-white/60">Score</p>
                      <p className="text-2xl font-semibold text-amber-200">{formatStat(value)}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            {leaderboardRest.length > 0 && (
              <div className="space-y-3">
                {leaderboardRest.map((member, idx) => {
                  const value = getStatValue(member)
                  const ratio = progressRatio(value)
                  return (
                    <motion.div
                      key={member.id}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      transition={{ duration: 0.25, delay: idx * 0.03 }}
                      className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
                    >
                      <div className="flex items-center justify-between text-sm text-slate-300">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">{idx + 4}</span>
                          <div>
                            <p className="font-semibold text-white">{member.name}</p>
                            <p className="text-xs text-slate-400">{member.crew}</p>
                          </div>
                        </div>
                        <span className="text-amber-300 font-semibold">{formatStat(value)}</span>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${Math.max(10, ratio * 100)}%` }}
                        />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={`space-y-5 ${THEME.panel} p-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Crew kudos</h2>
            <p className="text-sm text-slate-400">Client and crew shout-outs with emoji love.</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {sortedKudos.map((entry, index) => (
            <motion.div
              key={entry.id}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.35, delay: index * 0.05 }}
              className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg"
            >
              <div className="relative aspect-video">
                <img
                  src={entry.image}
                  alt={entry.message}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
                <div className="absolute inset-0 flex flex-col justify-end p-6 text-white">
                  <p className="text-sm uppercase tracking-wide text-white/80">{entry.crew}</p>
                  <p className="mt-2 text-lg font-semibold">{entry.message}</p>
                  <p className="text-xs text-white/70">
                    {new Date(entry.timestamp).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <AnimatePresence>
                  {floatingReactions
                    .filter((item) => item.kudoId === entry.id)
                    .map((item) => (
                      <motion.span
                        key={item.id}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: -20 }}
                        exit={{ opacity: 0, y: -36 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                        className="pointer-events-none absolute right-6 bottom-6 text-2xl"
                      >
                        {item.emoji}
                      </motion.span>
                    ))}
                </AnimatePresence>
              </div>

              <div className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  {reactionEmojis.map((emoji) => (
                    <motion.button
                      key={emoji}
                      onClick={() => handleReact(entry.id, emoji)}
                      whileTap={{ scale: 0.92 }}
                      className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-sm text-slate-200 transition hover:border-amber-400 hover:text-amber-300"
                    >
                      <span className="text-lg">{emoji}</span>
                      <span className="font-semibold">{entry.reactions[emoji] ?? 0}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  )
}

function ProfileScreen({
  user,
  onLogout,
  syncStatus,
  onSyncNow,
}: {
  user: User
  onLogout: () => void
  syncStatus: SyncState
  onSyncNow: () => void
}) {
  const initialAchievements = useMemo<Record<AchievementKey, string | null>>(
    () => ({
      five_streak: null,
      route_master: new Date('2025-11-10T09:15:00Z').toISOString(),
      client_favorite: null,
    }),
    [],
  )

  const [achievements, setAchievements] = useState<Record<AchievementKey, string | null>>(
    initialAchievements,
  )
  const [unlockedBadge, setUnlockedBadge] = useState<AchievementKey | null>(null)
  const lastSyncLabel = useMemo(() => formatRelativeTimestamp(syncStatus.lastSyncedAt), [syncStatus.lastSyncedAt])

  const badgeMeta: Record<
    AchievementKey,
    { title: string; description: string; icon: string }
  > = {
    five_streak: {
      title: 'Five-Day Streak',
      description: 'Logged flawless installs five days in a row.',
      icon: '💫',
    },
    route_master: {
      title: 'Route Master',
      description: 'Optimised a route that saved the crews over an hour.',
      icon: '🗺️',
    },
    client_favorite: {
      title: 'Client Favourite',
      description: 'Pulled in 10+ kudos from VIP clients.',
      icon: '🏆',
    },
  }

  const unlockBadge = (key: AchievementKey) => {
    setAchievements((prev) => {
      if (prev[key]) {
        return prev
      }
      return {
        ...prev,
        [key]: new Date().toISOString(),
      }
    })
    setUnlockedBadge(key)
  }

  const closeModal = () => setUnlockedBadge(null)

  return (
    <div className="space-y-6 pb-24">
      <section className={`space-y-4 ${THEME.panel} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Trophy Case</h2>
            <p className="text-sm text-slate-400">
              Track your unlocked achievements and aim for the next milestone.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => unlockBadge('five_streak')}
              className="rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-400 hover:text-amber-300"
            >
              Debug unlock • Five-Day Streak
            </button>
            <button
              onClick={() => unlockBadge('client_favorite')}
              className="rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-400 hover:text-amber-300"
            >
              Debug unlock • Client Favourite
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(badgeMeta) as AchievementKey[]).map((key, index) => {
            const unlockedAt = achievements[key]
            const unlocked = Boolean(unlockedAt)
            const meta = badgeMeta[key]
            return (
              <motion.div
                key={key}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className={`relative overflow-hidden rounded-2xl border p-5 transition ${
                  unlocked
                    ? 'border-amber-400/60 bg-amber-500/10 shadow-[0_0_35px_rgba(251,191,36,0.35)]'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500'
                }`}
              >
                <div
                  className={`absolute -right-10 -top-10 h-24 w-24 rounded-full blur-3xl ${
                    unlocked ? 'bg-amber-400/40' : 'bg-transparent'
                  }`}
                />
                <div className="relative z-10 flex flex-col gap-3">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl ${
                      unlocked
                        ? 'bg-amber-500/20 text-amber-200'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {meta.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{meta.title}</h3>
                    <p className="text-sm text-slate-400">{meta.description}</p>
                  </div>
                  <div className="pt-2">
                    {unlocked ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
                        Unlocked {new Date(unlockedAt ?? '').toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/40 px-3 py-1 text-xs font-medium text-slate-500">
                        Locked
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </section>

      <section className={`space-y-3 ${THEME.panelSubtle} p-6`}>
        <h3 className="text-lg font-semibold text-white">Crew identity</h3>
        <p className="text-sm text-slate-400">
          {user.name} • {user.role === 'admin' ? 'Admin' : 'Crew'} • Midnight Amber ops theme
        </p>
      </section>

      <section className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl ${THEME.panel} p-6`}>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-white">Session controls</h3>
          <p className="text-sm text-slate-400">
            Sync and log out when you hand off the board or switch crews.
          </p>
          <p className="text-xs text-slate-500">
            Sync {syncStatus.status}
            {syncStatus.queued > 0 ? ` · ${syncStatus.queued} queued` : ''}
            {` · Last sync ${lastSyncLabel}`}
          </p>
          {syncStatus.lastError && (
            <p className="text-xs text-rose-300">Last error: {syncStatus.lastError}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onSyncNow}
            disabled={syncStatus.status === 'pushing'}
            className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-transparent px-5 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:opacity-60"
          >
            Sync now
          </Button>
          <Button
            onClick={onLogout}
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </section>

      <AnimatePresence>
        {unlockedBadge && (
          <motion.div
            key="badge-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="relative w-full max-w-md rounded-2xl border border-amber-400/40 bg-slate-950/90 p-6 text-white shadow-[0_0_45px_rgba(251,191,36,0.35)]"
            >
              <div className="flex flex-col items-center gap-4 text-center">
                <motion.div
                  initial={{ rotate: 0 }}
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
                  className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-400 bg-amber-500/20 text-3xl text-amber-200"
                >
                  {badgeMeta[unlockedBadge].icon}
                </motion.div>
                <div>
                  <p className="text-sm uppercase tracking-[0.4rem] text-amber-200/70">
                    Badge unlocked!
                  </p>
                  <h4 className="mt-2 text-2xl font-semibold text-white">
                    {badgeMeta[unlockedBadge].title}
                  </h4>
                  <p className="mt-2 text-sm text-slate-300">
                    {badgeMeta[unlockedBadge].description}
                  </p>
                </div>
                <Button
                  onClick={closeModal}
                  className="rounded-full border border-amber-400 bg-amber-500 px-6 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
                >
                  Continue
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AppShell() {
  const [user, setUser] = useState<User | null>(null)
  const [pin, setPin] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cached = await restoreCachedUser()
      if (!cancelled && cached) {
        setUser(cached)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogin = useCallback(
    (name: string, candidatePin: string): boolean => {
      if (!isPinValid(name, candidatePin)) {
        return false
      }
      setUser({ name, role: getRoleForCrew(name) })
      setPin('')
      return true
    },
    [],
  )

  const handleLogout = useCallback(() => {
    setUser(null)
    void persistUser(null)
  }, [])

  return (
    <BrowserRouter>
      {user ? (
        <Routes>
          <Route path="/crew/profiles" element={<Profiles />} />
          <Route path="/crew/profiles/:userId" element={<ProfileDetail />} />
          <Route path="/crew/leaderboards" element={<Leaderboards />} />
          <Route path="/crew/awards" element={<Awards />} />
          <Route path="*" element={<AuthedShell user={user} onLogout={handleLogout} />} />
        </Routes>
      ) : (
        <LoginShell pin={pin} setPin={setPin} onLogin={handleLogin} />
      )}
    </BrowserRouter>
  )
}

export default function SONLApp() {
  return <AppShell />
}
