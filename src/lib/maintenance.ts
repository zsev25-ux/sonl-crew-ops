import { db } from '@/lib/db'
import { safePrepareJobForFirestore } from '@/lib/job-schema'
import { safeSerialize } from '@/lib/sanitize'

export type CleanupSummary = {
  jobsFixed: number
  pendingFixed: number
}

export const runLocalDataCleanup = async (): Promise<CleanupSummary> => {
  let jobsFixed = 0
  let pendingFixed = 0

  await db.transaction('rw', [db.jobs, db.pendingOps], async () => {
    await db.jobs.toCollection().modify((record) => {
      const docId = (record as { id?: unknown })?.id
      const prepared = safePrepareJobForFirestore(record, {
        docPath: `cleanup/jobs/${docId ?? 'unknown'}`,
      })
      if (prepared.success) {
        const { data } = prepared.result
        const merged = safeSerialize({
          ...record,
          id: data.id,
          date: data.date,
          crew: data.crew,
          client: data.client,
          scope: data.scope,
          notes: data.notes,
          address: data.address,
          neighborhood: data.neighborhood,
          zip: data.zip,
          houseTier: data.houseTier,
          rehangPrice: data.rehangPrice ?? undefined,
          lifetimeSpend: data.lifetimeSpend ?? undefined,
          vip: data.vip,
          bothCrews: data.crew === 'Both Crews',
          meta: data.meta ?? (record as Record<string, unknown>).meta,
        })
        Object.assign(record, merged)
        jobsFixed += 1
      } else {
        Object.assign(record, safeSerialize(record))
      }
    })

    await db.pendingOps.toCollection().modify((record) => {
      if (!record || typeof record !== 'object') {
        return
      }
      const payload = (record as { payload?: unknown }).payload
      if (payload && typeof payload === 'object') {
        const payloadRecord = payload as Record<string, unknown>
        if (payloadRecord.job) {
          const jobId = (payloadRecord.job as { id?: unknown })?.id ?? (record as { id?: string }).id
          const prepared = safePrepareJobForFirestore(payloadRecord.job, {
            docPath: `cleanup/pending/${jobId ?? 'unknown'}`,
          })
          if (prepared.success) {
            payloadRecord.job = prepared.result.data
          } else {
            delete payloadRecord.job
          }
          pendingFixed += 1
        }
        ;(record as Record<string, unknown>).payload = safeSerialize(payloadRecord)
      }
    })
  })

  return { jobsFixed, pendingFixed }
}
