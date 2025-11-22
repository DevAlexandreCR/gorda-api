import { QueryInterface, QueryTypes } from 'sequelize'
import * as path from 'path'
import * as fs from 'fs'

interface ClientDumpRecord {
  id?: string
  name?: string
  phone?: string
}

type ClientsDump = Record<string, ClientDumpRecord>

module.exports = {
  async up(queryInterface: QueryInterface): Promise<void> {
    const dumpPath = path.join(__dirname, 'Dump', 'clients.json')

    if (!fs.existsSync(dumpPath)) {
      console.warn(`Clients dump not found at ${dumpPath}, skipping import.`)
      return
    }

    const dumpContent = fs.readFileSync(dumpPath, 'utf8')
    const clientsDump: ClientsDump = JSON.parse(dumpContent)

    const seenIds = new Set<string>()

    const records = Object.entries(clientsDump).reduce<
      Array<{
        id: string
        name: string
        phone: string
        photo_url: string
        created_at: Date
        updated_at: Date
      }>
    >((acc, [key, client]) => {
      const normalizedPhone = getNormalizedPhone(client.phone ?? key)
      if (!normalizedPhone) return acc

      const numericId = getNormalizedId(client.id ?? normalizedPhone.replace('+', ''))
      if (!numericId) return acc

      if (seenIds.has(numericId)) {
        return acc
      }

      seenIds.add(numericId)

      acc.push({
        id: numericId,
        name: (client.name ?? 'Usuario').trim(),
        phone: normalizedPhone,
        photo_url: '',
        created_at: new Date(),
        updated_at: new Date(),
      })

      return acc
    }, [])

    if (!records.length) {
      console.log('No clients found in dump, skipping import.')
      return
    }

    const existingIds = await findExistingIds(queryInterface, records.map((record) => record.id))
    const newRecords = records.filter((record) => !existingIds.has(record.id))

    if (!newRecords.length) {
      console.log('All clients from dump already exist, skipping import.')
      return
    }

    const batchSize = 200
    let insertedCount = 0
    for (let i = 0; i < newRecords.length; i += batchSize) {
      const batch = newRecords.slice(i, i + batchSize)
      await queryInterface.bulkInsert('clients', batch, {
        // Postgres supports ON CONFLICT DO NOTHING but typings miss the option
        ignoreDuplicates: true,
      } as any)
      insertedCount += batch.length
    }

    console.log(
      `Successfully attempted to import ${insertedCount} clients from dump (skipped ${existingIds.size} existing ids)`
    )
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.bulkDelete('clients', {}, {})
  },
}

function getNormalizedPhone(value: string): string {
  const digits = (value ?? '').toString().replace(/[^\d]/g, '')
  if (!digits) return ''
  return `+${digits}`
}

function getNormalizedId(value: string): string {
  const digits = (value ?? '').toString().replace(/[^\d]/g, '')
  return digits
}

async function findExistingIds(queryInterface: QueryInterface, ids: string[]): Promise<Set<string>> {
  const idSet = new Set<string>()
  if (!ids.length) return idSet

  const chunkSize = 1000
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const rows = (await queryInterface.sequelize.query<{ id: string }>(
      'SELECT id FROM clients WHERE id IN (:ids)',
      {
        replacements: { ids: chunk },
        type: QueryTypes.SELECT,
      }
    )) as Array<{ id: string }>

    rows.forEach((row) => idSet.add(String(row.id)))
  }

  return idSet
}
