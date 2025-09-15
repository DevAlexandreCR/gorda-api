import DBService from '../Services/firebase/Database'
import { PlaceInterface } from '../Interfaces/PlaceInterface'
import Place from '../Models/Place'
import { PrismaClient } from '../../generated/prisma'

class PlaceRepository {
  private prisma: PrismaClient

  constructor() {
    this.prisma = new PrismaClient()
  }

  /* istanbul ignore next */
  getAll(listener: (place: Place) => void): void {
    DBService.dbPlaces().on('child_added', (snapshot) => {
      const place = snapshot.val() as PlaceInterface
      const placeTmp = new Place
      Object.assign(placeTmp, place)
      placeTmp.key = snapshot.key ?? ''
      listener(placeTmp)
    })
  }

  /**
   * Get all places for a specific city
   */
  async index(cityId: string) {
    const places = await this.prisma.place.findMany({
      where: { cityId },
      select: {
        name: true,
        lat: true,
        lng: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return places
  }

  /**
   * Store a new place
   */
  async store(data: {
    name: string
    lat: number
    lng: number
    cityId: string
  }) {
    try {
      const place = await this.prisma.place.create({
        data,
        include: {
          city: {
            include: {
              branch: true
            }
          }
        }
      })

      return {
        id: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        country: place.city.branch.country,
        city: place.city.name,
        cityId: place.cityId,
        createdAt: place.createdAt,
        updatedAt: place.updatedAt
      }
    } catch (error: any) {
      throw error
    }
  }

  /**
   * Find place by id
   */
  async findById(id: string) {
    const place = await this.prisma.place.findUnique({
      where: { id },
      include: {
        city: {
          include: {
            branch: true
          }
        }
      }
    })

    if (!place) return null

    return {
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      country: place.city.branch.country,
      city: place.city.name,
      cityId: place.cityId,
      createdAt: place.createdAt,
      updatedAt: place.updatedAt
    }
  }

  /**
   * Find places within city polygon boundaries
   */
  async findPlacesWithinCityPolygon(lat: number, lng: number) {
    const places = await this.prisma.$queryRaw`
      SELECT p.*, c.name as city_name, b.country
      FROM places p
      JOIN cities c ON p.city_id = c.id
      JOIN branches b ON c.branch_id = b.id
      WHERE c.polygon IS NOT NULL 
      AND ST_Contains(c.polygon, ST_Point(${lng}, ${lat}))
    ` as any[]

    return places.map(place => ({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      country: place.country,
      city: place.city_name,
      cityId: place.city_id,
      createdAt: place.created_at,
      updatedAt: place.updated_at
    }))
  }

  async disconnect() {
    await this.prisma.$disconnect()
  }
}

export default PlaceRepository