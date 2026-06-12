import sequelize from '../src/Database/sequelize'
import { normalizePlate } from '../src/Helpers/PlateHelper'
import { QueryTypes } from 'sequelize'
import fs from 'fs'
import path from 'path'

interface DriverRow {
  id: string
  name: string
  email: string
}

interface DriverWithVehicle extends DriverRow {
  vehicle: { plate?: string; brand?: string; model?: string } | null
}

interface DriverWithPlate extends DriverRow {
  plate: string
}

async function main(): Promise<void> {
  const outputArg = process.argv.indexOf('--output')
  const outputFile = outputArg !== -1 ? process.argv[outputArg + 1] : null

  // 1. Drivers with empty/null vehicle JSONB
  const emptyVehicle = (await sequelize.query(
    `SELECT id, name, email FROM drivers WHERE vehicle IS NULL OR vehicle = '{}'::jsonb OR vehicle = 'null'::jsonb`,
    { type: QueryTypes.SELECT }
  )) as DriverRow[]

  // 2. Drivers with malformed vehicle (missing plate, brand, or model)
  const malformed = (await sequelize.query(
    `SELECT id, name, email, vehicle FROM drivers
     WHERE vehicle IS NOT NULL
       AND vehicle != '{}'::jsonb
       AND vehicle != 'null'::jsonb
       AND (
         vehicle->>'plate' IS NULL OR vehicle->>'plate' = ''
         OR vehicle->>'brand' IS NULL OR vehicle->>'brand' = ''
         OR vehicle->>'model' IS NULL OR vehicle->>'model' = ''
       )`,
    { type: QueryTypes.SELECT }
  )) as DriverWithVehicle[]

  // 3. Duplicate normalized plates
  const allWithPlates = (await sequelize.query(
    `SELECT id, name, email, vehicle->>'plate' as plate FROM drivers
     WHERE vehicle->>'plate' IS NOT NULL AND vehicle->>'plate' != ''`,
    { type: QueryTypes.SELECT }
  )) as DriverWithPlate[]

  // Group by normalized plate
  const plateMap = new Map<string, DriverWithPlate[]>()
  for (const row of allWithPlates) {
    const normalized = normalizePlate(row.plate)
    if (!plateMap.has(normalized)) plateMap.set(normalized, [])
    plateMap.get(normalized)!.push(row)
  }
  const duplicates = Array.from(plateMap.entries()).filter(([, rows]) => rows.length > 1)

  // Build CSV
  const lines: string[] = []
  lines.push('section,driver_id,name,email,plate,normalized_plate,note')

  for (const row of emptyVehicle) {
    lines.push(`empty_vehicle,${row.id},"${row.name}","${row.email}",,,"empty or null JSONB"`)
  }

  for (const row of malformed) {
    const plate = row.vehicle?.plate ?? ''
    lines.push(`malformed_vehicle,${row.id},"${row.name}","${row.email}","${plate}",,,"missing required field"`)
  }

  for (const [normalized, rows] of duplicates) {
    for (const row of rows) {
      lines.push(
        `duplicate_plate,${row.id},"${row.name}","${row.email}","${row.plate}","${normalized}","collides with ${rows.length} drivers"`
      )
    }
  }

  const csv = lines.join('\n')

  if (outputFile) {
    fs.writeFileSync(path.resolve(outputFile), csv, 'utf8')
    console.error(`Report written to ${path.resolve(outputFile)}`)
  } else {
    console.log(csv)
  }

  await sequelize.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
