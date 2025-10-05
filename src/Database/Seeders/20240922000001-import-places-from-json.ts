import { QueryInterface, DataTypes, Op } from 'sequelize'
import * as path from 'path'
import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'

interface PlaceData {
  lat: number
  lng: number
  name: string
}

interface PlacesJson {
  [key: string]: PlaceData
}

interface PlaceRecord {
  id: string
  name: string
  lat: number
  lng: number
  location: any
  city_id: string
  created_at: Date
  updated_at: Date
}

module.exports = {
  async up(queryInterface: QueryInterface, Sequelize: typeof DataTypes): Promise<void> {
    // Read places.json file
    const placesJsonPath = path.join(__dirname, 'Dump', 'places.json')
    const placesJsonContent = fs.readFileSync(placesJsonPath, 'utf8')
    const placesData: PlacesJson = JSON.parse(placesJsonContent)

    // Transform places data for database insertion
    const placesToInsert: PlaceRecord[] = Object.entries(placesData).map(([_, place]) => ({
      id: uuidv4(), // Generate a new UUID for the database ID
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      location: queryInterface.sequelize.fn('ST_GeomFromText', `POINT(${place.lng} ${place.lat})`, 4326),
      city_id: 'popayan', // Assuming all places are in Popayan based on existing seeders
      created_at: new Date(),
      updated_at: new Date(),
    }))

    // Insert places in batches to avoid potential query size limits
    const batchSize = 100
    for (let i = 0; i < placesToInsert.length; i += batchSize) {
      const batch = placesToInsert.slice(i, i + batchSize)
      await queryInterface.bulkInsert('places', batch, {})
    }

    console.log(`Successfully imported ${placesToInsert.length} places from places.json`)
  },

  async down(queryInterface: QueryInterface, Sequelize: typeof DataTypes): Promise<void> {
    // Delete all places from popayan that were likely imported from this seeder
    // Note: This will delete ALL places with city_id 'popayan'
    await queryInterface.bulkDelete(
      'places',
      {
        city_id: 'popayan'
      },
      {}
    )

    console.log('Successfully removed places imported from places.json')
  },
}