import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Database from '../Services/firebase/Database'
import { ServiceInterface } from '../Interfaces/ServiceInterface'
import ServiceHistoryMigrationService from '../Services/serviceHistory/ServiceHistoryMigrationService'

dayjs.extend(utc)
dayjs.extend(timezone)

type Phase2Dataset = 'service_history' | 'service_metrics' | 'all'
type Phase2Cursor = {
  createdAt: number
  key: string
}

const SERVICE_HISTORY_BATCH_SIZE = Math.max(
  Number.parseInt(process.env.PHASE2_SERVICE_HISTORY_BATCH_SIZE ?? '250', 10) || 250,
  1
)

const DATASET = (process.argv[2] ?? 'all') as Phase2Dataset
const service = new ServiceHistoryMigrationService()

async function backfillServiceHistory(): Promise<{
  scanned: number
  upserted: number
  skipped: number
  batches: number
  batchSize: number
}> {
  let scanned = 0
  let upserted = 0
  let skipped = 0
  let batches = 0
  let cursor: Phase2Cursor | null = null

  while (true) {
    let query = Database.dbServices().orderByChild('created_at')

    if (cursor) {
      query = query.startAt(cursor.createdAt, cursor.key).limitToFirst(SERVICE_HISTORY_BATCH_SIZE + 1)
    } else {
      query = query.startAt(service.getBoundaryUnix()).limitToFirst(SERVICE_HISTORY_BATCH_SIZE)
    }

    const snapshot = await query.once('value')
    const batchRows: Array<{ key: string; service: ServiceInterface }> = []

    snapshot.forEach((child) => {
      if (!child.key) return false
      if (cursor && child.key === cursor.key) return false

      const value = child.val() ?? {}
      batchRows.push({
        key: child.key,
        service: {
          ...value,
          id: value.id ?? child.key,
        } as ServiceInterface,
      })
      return false
    })

    if (batchRows.length === 0) {
      break
    }

    scanned += batchRows.length

    await Promise.all(
      batchRows.map(async ({ service: rawService }) => {
        if (!service.isEligibleFinalService(rawService)) {
          skipped++
          return
        }

        await service.upsertHistoryRecord(rawService)
        upserted++
      })
    )

    batches += 1

    const lastService = batchRows[batchRows.length - 1]
    cursor = {
      createdAt: Number(lastService.service.created_at ?? 0),
      key: lastService.key,
    }

    console.log('Phase 2 service history batch summary:', {
      batch: batches,
      batchSize: batchRows.length,
      scanned,
      upserted,
      skipped,
      cursor,
    })

    if (batchRows.length < SERVICE_HISTORY_BATCH_SIZE) {
      break
    }
  }

  return { scanned, upserted, skipped, batches, batchSize: SERVICE_HISTORY_BATCH_SIZE }
}

async function rebuildMetrics(): Promise<number> {
  return service.rebuildAllMetrics()
}

async function main(): Promise<void> {
  let historySummary = {
    scanned: 0,
    upserted: 0,
    skipped: 0,
    batches: 0,
    batchSize: SERVICE_HISTORY_BATCH_SIZE,
  }
  let metricsRows = 0

  switch (DATASET) {
    case 'service_history':
      historySummary = await backfillServiceHistory()
      break
    case 'service_metrics':
      metricsRows = await rebuildMetrics()
      break
    case 'all':
      historySummary = await backfillServiceHistory()
      metricsRows = await rebuildMetrics()
      break
    default:
      throw new Error(`Unsupported Phase 2 dataset selector: ${DATASET}`)
  }

  console.log('Phase 2 backfill summary:', {
    dataset: DATASET,
    historySummary,
    metricsRows,
    executedAt: dayjs().toISOString(),
  })
}

void main().catch((error) => {
  console.error('Phase 2 backfill failed:', error)
  process.exit(1)
})
