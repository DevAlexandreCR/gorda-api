import { QueryInterface } from 'sequelize'
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

      acc.push({
        id: client.id ?? `${normalizedPhone.replace('+', '')}@c.us`,
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

    const batchSize = 200
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      await queryInterface.bulkInsert('clients', batch, {})
    }

    console.log(`Successfully imported ${records.length} clients from dump`)
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
