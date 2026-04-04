import Container from '../Container/Container'
import Database from '../Services/firebase/Database'

type DriverTokenRow = {
  driverId: string
  token: string
}

type DuplicateConflict = {
  token: string
  keptDriverId: string
  skippedDriverIds: string[]
  reason: 'existing_sql_owner' | 'driver_id_asc'
}

async function main(): Promise<void> {
  await Container.initialize()

  const snapshot = await Database.dbTokens().once('value')
  const driverTokenRepository = Container.getDriverTokenRecordRepository()
  const rows: DriverTokenRow[] = []
  let skippedEmpty = 0

  snapshot.forEach((child) => {
    const driverId = String(child.key ?? '').trim()
    const token = String(child.val() ?? '').trim()

    if (!driverId || !token) {
      skippedEmpty += 1
      return
    }

    rows.push({ driverId, token })
  })

  const rowsByToken = new Map<string, DriverTokenRow[]>()

  for (const row of rows) {
    const tokenRows = rowsByToken.get(row.token) ?? []
    tokenRows.push(row)
    rowsByToken.set(row.token, tokenRows)
  }

  const duplicateConflicts: DuplicateConflict[] = []
  const resolvedRows: DriverTokenRow[] = []

  for (const [token, tokenRows] of rowsByToken.entries()) {
    if (tokenRows.length === 1) {
      resolvedRows.push(tokenRows[0])
      continue
    }

    const sortedRows = [...tokenRows].sort((left, right) =>
      left.driverId.localeCompare(right.driverId)
    )
    const existingOwner = await driverTokenRepository.findByToken(token)
    const keptDriverId =
      existingOwner?.driver_id && sortedRows.some((row) => row.driverId === existingOwner.driver_id)
        ? existingOwner.driver_id
        : sortedRows[0].driverId
    const keptRow = sortedRows.find((row) => row.driverId === keptDriverId) ?? sortedRows[0]
    const skippedDriverIds = sortedRows
      .filter((row) => row.driverId !== keptRow.driverId)
      .map((row) => row.driverId)

    resolvedRows.push(keptRow)
    duplicateConflicts.push({
      token,
      keptDriverId: keptRow.driverId,
      skippedDriverIds,
      reason:
        existingOwner?.driver_id && keptRow.driverId === existingOwner.driver_id
          ? 'existing_sql_owner'
          : 'driver_id_asc',
    })
  }

  let insertedOrUpdated = 0
  let failed = 0

  for (const row of resolvedRows) {
    try {
      await driverTokenRepository.upsert(row.driverId, row.token)
      insertedOrUpdated += 1
    } catch (error) {
      failed += 1
      console.error(
        `Failed to backfill driver token for driver ${row.driverId} and token ${row.token}:`,
        error
      )
    }
  }

  console.log(
    'Phase 3 driver token backfill summary:',
    JSON.stringify(
      {
        read: rows.length,
        inserted_or_updated: insertedOrUpdated,
        skipped_empty: skippedEmpty,
        skipped_duplicates: duplicateConflicts.reduce(
          (total, conflict) => total + conflict.skippedDriverIds.length,
          0
        ),
        failed,
      },
      null,
      2
    )
  )

  if (duplicateConflicts.length > 0) {
    console.log(
      'Phase 3 driver token duplicate conflicts:',
      JSON.stringify(
        duplicateConflicts.map((conflict) => ({
          token: conflict.token,
          kept_driver_id: conflict.keptDriverId,
          skipped_driver_ids: conflict.skippedDriverIds,
          reason: conflict.reason,
        })),
        null,
        2
      )
    )
  }

  await Container.cleanup()
}

main().catch(async (error) => {
  console.error('Phase 3 driver token backfill failed:', error)
  await Container.cleanup()
  process.exit(1)
})
