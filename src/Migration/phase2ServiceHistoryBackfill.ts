import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Database from '../Services/firebase/Database'
import { ServiceInterface } from '../Interfaces/ServiceInterface'
import ServiceHistoryMigrationService from '../Services/serviceHistory/ServiceHistoryMigrationService'

dayjs.extend(utc)
dayjs.extend(timezone)

type Phase2Dataset = 'service_history' | 'service_metrics' | 'all'

const DATASET = (process.argv[2] ?? 'all') as Phase2Dataset
const service = new ServiceHistoryMigrationService()

async function backfillServiceHistory(): Promise<{
  scanned: number
  upserted: number
  skipped: number
}> {
  const snapshot = await Database.dbServices()
    .orderByChild('created_at')
    .startAt(service.getBoundaryUnix())
    .once('value')
  let scanned = 0
  let upserted = 0
  let skipped = 0

  snapshot.forEach((child) => {
    scanned++
    return false
  })

  const tasks = snapshot.val()
    ? Object.values(snapshot.val() as Record<string, ServiceInterface>).map(async (rawService) => {
        if (!service.isEligibleFinalService(rawService)) {
          skipped++
          return
        }

        await service.upsertHistoryRecord(rawService)
        upserted++
      })
    : []

  await Promise.all(tasks)

  return { scanned, upserted, skipped }
}

async function rebuildMetrics(): Promise<number> {
  return service.rebuildAllMetrics()
}

async function main(): Promise<void> {
  let historySummary = { scanned: 0, upserted: 0, skipped: 0 }
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
