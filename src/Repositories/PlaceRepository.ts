import DBService from '../Services/firebase/Database'
import { PlaceInterface } from '../Interfaces/PlaceInterface'
import Place from '../Models/Place'
import { Sequelize, QueryTypes } from 'sequelize'
import SequelizePlace from '../Models/Place'
import City from '../Models/City'
import Branch from '../Models/Branch'

class PlaceRepository {
  private sequelize: Sequelize

  constructor(sequelizeInstance: Sequelize) {
    this.sequelize = sequelizeInstance
  }

  // /* istanbul ignore next */
  // getAll(listener: (place: Place) => void): void {
  //   DBService.dbPlaces().on('child_added', (snapshot) => {
  //     const place = snapshot.val() as PlaceInterface
  //     const placeTmp = new Place
  //     Object.assign(placeTmp, place)
  //     placeTmp.key = snapshot.key ?? ''
  //     listener(placeTmp)
  //   })
  // }

  async index(cityId: string): Promise<PlaceInterface[]> {
    const places = await SequelizePlace.findAll({
      where: { cityId },
      attributes: ['id', 'name', 'lat', 'lng'],
      include: [{
        model: City,
        as: 'city',
        attributes: ['name'],
        include: [{
          model: Branch,
          as: 'branch',
          attributes: ['country']
        }]
      }],
      order: [['createdAt', 'DESC']]
    })

    return places.map(place => {
      const placeData = place.get({ plain: true }) as any
      return {
        key: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        country: placeData.city?.branch?.country || '',
        city: placeData.city?.name || ''
      }
    })
  }

  async store(placeData: { name: string; lat: number; lng: number; cityId: string }): Promise<PlaceInterface> {
    const place = await SequelizePlace.create({
      name: placeData.name,
      lat: placeData.lat,
      lng: placeData.lng,
      location: {
        type: 'Point',
        coordinates: [placeData.lng, placeData.lat],
        crs: { type: 'name', properties: { name: 'EPSG:4326' } }
      },
      cityId: placeData.cityId
    })

    return {
      key: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      country: '',
      city: ''
    }
  }

  async findById(id: string): Promise<PlaceInterface | null> {
    const place = await SequelizePlace.findByPk(id, {
      include: [{
        model: City,
        as: 'city',
        attributes: ['name'],
        include: [{
          model: Branch,
          as: 'branch',
          attributes: ['country']
        }]
      }]
    })

    if (!place) return null

    const placeData = place.get({ plain: true }) as any
    return {
      key: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      country: placeData.city?.branch?.country || '',
      city: placeData.city?.name || ''
    }
  }

  async findPlacesWithinCityPolygon(cityId: string): Promise<PlaceInterface[]> {
    const places = await this.sequelize.query(`
      SELECT p.id, p.name, p.lat, p.lng, c.name as city_name, b.country
      FROM places p
      JOIN cities c ON p.city_id = c.id
      JOIN branches b ON c.branch_id = b.id
      WHERE c.id = :cityId
      AND ST_Within(p.location, c.polygon)
    `, {
      replacements: { cityId },
      type: QueryTypes.SELECT
    }) as any[]

    return places.map(place => ({
      key: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      country: place.country,
      city: place.city_name
    }))
  }
}

export default PlaceRepository
