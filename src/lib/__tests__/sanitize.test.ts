import { describe, expect, it } from 'vitest'
import { parseJob } from '@/lib/job-schema'
import { safeSerialize, stripUndefined, type SanitizeReport } from '@/lib/sanitize'

const createDirtyJob = () => ({
  id: '42',
  date: ' 2025-12-01 ',
  crew: 'Both Crews',
  client: '  Test Client  ',
  scope: ' Install display ',
  notes: '   ',
  address: undefined,
  neighborhood: ' Downtown ',
  zip: undefined,
  houseTier: '7',
  rehangPrice: Number.NaN,
  lifetimeSpend: Number.POSITIVE_INFINITY,
  vip: 'true',
})

describe('sanitize utilities', () => {
  it('strips undefined and normalises numbers for Firestore payloads', () => {
    const { job, changes } = parseJob(createDirtyJob())
    const report: SanitizeReport = { removed: [], changes: [] }
    const clean = safeSerialize(job, { report })

    expect(clean.id).toBe(42)
    expect(clean.notes).toBe('')
    expect(clean.neighborhood).toBe('Downtown')
    expect(clean.zip).toBe('')
    expect(clean.houseTier).toBe(5)
    expect(clean.rehangPrice).toBe(0)
    expect(clean.lifetimeSpend).toBe(0)
    expect(clean.vip).toBe(true)
    expect(clean.bothCrews).toBe(true)
    expect(report.removed).toEqual(['meta'])
    expect(changes.some((change) => change.path === 'houseTier')).toBe(true)
  })

  it('removes undefined keys in nested objects', () => {
    const payload = {
      name: 'media',
      nested: {
        keep: 'value',
        skip: undefined,
      },
      list: [1, undefined, 3],
    }
    const stripped = stripUndefined(payload)
    expect(stripped).toStrictEqual({ name: 'media', nested: { keep: 'value' }, list: [1, 3] })
  })
})
