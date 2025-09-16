import DBService from '../Services/firebase/Database'
import { PlaceInterface } from '../Interfaces/PlaceInterface'
import Place from '../Models/Place'
import { PrismaClient } from '../../generated/prisma'

class PlaceRepository {
  private prisma: PrismaClient

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient
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

  async index(cityId: string): Promise<PlaceInterface[]> {
    const places = await this.prisma.place.findMany({
      where: { cityId },
      select: {
        id: true,
        name: true,
        lat: true,
        lng: true,
        city: {
          select: {
            name: true,
            branch: {
              select: {
                country: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return places.map(place => ({
      key: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      country: place.city.branch.country,
      city: place.city.name
    }))
  }

  async store(data: {
    name: string
    lat: number
    lng: number
    cityId: string
  }) {
    try {
      const place = await this.prisma.place.create({
        data: {
          name: data.name,
          lat: data.lat,
          lng: data.lng,
          cityId: data.cityId,
          location: `POINT(${data.lng} ${data.lat})`
        },
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
        createdAt: place.createdAt,
        updatedAt: place.updatedAt
      }
    } catch (error: any) {
      throw error
    }
  }

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
    }
  }
}

export default PlaceRepository