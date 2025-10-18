import { describe, expect, it } from 'vitest'
import { prepareJobForFirestore } from '@/lib/job-schema'

describe('prepareJobForFirestore', () => {
  it('strips undefined and coerces invalid values', () => {
    const { data, warnings, report } = prepareJobForFirestore(
      {
        id: '42',
        date: ' 2025-01-02 ',
        crew: ' Crew Alpha ',
        client: ' Client Name ',
        scope: ' Install ',
        notes: '  ',
        neighborhood: undefined,
        zip: undefined,
        houseTier: '10',
        rehangPrice: Number.NaN,
        lifetimeSpend: Number.NEGATIVE_INFINITY,
        vip: 'true',
      },
      { docPath: 'jobs/42' },
    )

    expect(data.id).toBe(42)
    expect(data.date).toBe('2025-01-02')
    expect(data.crew).toBe('Crew Alpha')
    expect(data.client).toBe('Client Name')
    expect(data.notes).toBe('')
    expect(data.neighborhood).toBe('')
    expect(data.zip).toBe('')
    expect(data.houseTier).toBe(5)
    expect(data.rehangPrice).toBeNull()
    expect(data.lifetimeSpend).toBeNull()
    expect(data.vip).toBe(true)
    expect(report.removedPaths).toEqual(expect.arrayContaining(['updatedAt']))
  })

  it('throws when required fields are missing', () => {
    expect(() =>
      prepareJobForFirestore(
        {
          id: 1,
          date: '',
          crew: '',
          client: '',
          scope: '',
        },
        { docPath: 'jobs/1' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      "[JobValidationError: Sync failed: invalid data in \"jobs/1\" (date: date is required)]",
    )
  })
})
