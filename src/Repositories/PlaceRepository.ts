import { PlaceInterface } from '../Interfaces/PlaceInterface'
import { Sequelize, QueryTypes, Op } from 'sequelize'
import SequelizePlace from '../Models/Place'
import City from '../Models/City'
import Branch from '../Models/Branch'
import Place from '../Models/Place'

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
    const replacements: any = { name, cityId }
    let sql = `
    SELECT id, name, lat, lng, city_id, similarity(name, :name) AS score
    FROM "places"
    WHERE name % :name
    `
    if (cityId) sql += ' AND city_id = :cityId'
    sql += ' ORDER BY score DESC LIMIT 3'

    const places = await this.sequelize.query<PlaceInterface>(sql, {
      replacements,
      type: QueryTypes.SELECT,
    })

    return places as PlaceInterface[]
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
    )) as PlaceInterface[]

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
