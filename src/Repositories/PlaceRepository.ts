import { PlaceInterface } from '../Interfaces/PlaceInterface'
import { Sequelize, QueryTypes, Op } from 'sequelize'
import SequelizePlace from '../Models/Place'
import City from '../Models/City'
import Branch from '../Models/Branch'

class PlaceRepository {
  private sequelize: Sequelize

  constructor(sequelizeInstance: Sequelize) {
    this.sequelize = sequelizeInstance
  }

  async index(cityId: string): Promise<PlaceInterface[]> {
    const places = await SequelizePlace.findAll({
      where: { cityId },
      attributes: ['id', 'name', 'lat', 'lng'],
      include: [
        {
          model: City,
          as: 'city',
          attributes: ['name'],
          include: [
            {
              model: Branch,
              as: 'branch',
              attributes: ['country'],
            },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
    })

    return places.map((place) => {
      const placeData = place.get({ plain: true }) as any
      return placeData as PlaceInterface
    })
  }

  async store(placeData: {
    name: string
    lat: number
    lng: number
    cityId: string
  }): Promise<PlaceInterface> {
    const place = await SequelizePlace.create({
      name: placeData.name,
      lat: placeData.lat,
      lng: placeData.lng,
      location: {
        type: 'Point',
        coordinates: [placeData.lng, placeData.lat],
        crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      },
      cityId: placeData.cityId,
    })

    return place.get({ plain: true }) as PlaceInterface
  }

  async findById(id: string): Promise<PlaceInterface | null> {
    const place = await SequelizePlace.findByPk(id, {
      include: [
        {
          model: City,
          as: 'city',
          attributes: ['name'],
          include: [
            {
              model: Branch,
              as: 'branch',
              attributes: ['country'],
            },
          ],
        },
      ],
    })

    if (!place) return null

    return place.get({ plain: true }) as PlaceInterface
  }

  async findByName(name: string, cityId?: string): Promise<PlaceInterface[]> {
    const whereClause: any = {
      name: {
        [Op.iLike]: `%${name}%`,
      },
    }

    if (cityId) {
      whereClause.cityId = cityId
    }

    const places = await SequelizePlace.findAll({
      where: whereClause,
      attributes: ['id', 'name', 'lat', 'lng', 'cityId'],
      order: [['name', 'ASC']],
      limit: 3,
    })

    return places.map((place) => place.get({ plain: true }) as PlaceInterface)
  }

  async findPlacesWithinCityPolygon(cityId: string): Promise<PlaceInterface[]> {
    const places = (await this.sequelize.query(
      `
      SELECT p.id, p.name, p.lat, p.lng, c.name as city_name, b.country
      FROM places p
      JOIN cities c ON p.city_id = c.id
      JOIN branches b ON c.branch_id = b.id
      WHERE c.id = :cityId
      AND ST_Within(p.location, c.polygon)
    `,
      {
        replacements: { cityId },
        type: QueryTypes.SELECT,
      }
    )) as any[]

    return places
  }

  async delete(id: string): Promise<boolean> {
    const result = await SequelizePlace.destroy({
      where: { id },
    })

    return result > 0
  }
}

export default PlaceRepository
