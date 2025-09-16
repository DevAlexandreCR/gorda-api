import { Request, Response, Router } from "express"
import Container from "../../../container/Container"

const controller = Router()

/**
 * GET /places
 * Get all places for a specific city
 */
controller.get('/', async (req: Request, res: Response) => {
  try {
    const cityId = req.query.cityId as string

    // Validate required cityId parameter
    if (!cityId || typeof cityId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'CityId query parameter is required'
      })
    }

    const placeRepository = Container.getPlaceRepository()
    const places = await placeRepository.index(cityId)

    return res.status(200).json({
      success: true,
      data: places
    })
  } catch (error) {
    console.error('Error fetching places:', error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    })
  }
})

/**
 * POST /places
 * Create a new place
 */
controller.post('/', async (req: Request, res: Response) => {
  try {
    const { name, lat, lng, cityId } = req.body

    // Validate required fields
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required and must be a string' })
    }

    if (!lat || typeof lat !== 'number') {
      return res.status(400).json({ error: 'Latitude is required and must be a number' })
    }

    if (!lng || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Longitude is required and must be a number' })
    }

    if (!cityId || typeof cityId !== 'string') {
      return res.status(400).json({ error: 'CityId is required and must be a string' })
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90' })
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180' })
    }

    const placeRepository = Container.getPlaceRepository()
    const place = await placeRepository.store({
      name: name.trim(),
      lat,
      lng,
      cityId
    })

    return res.status(201).json({
      success: true,
      data: place
    })
  } catch (error: any) {
    console.error('Error creating place:', error)

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    })
  }
})

/**
 * GET /places/:id
 * Get a specific place by id
 */
controller.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({ error: 'Id parameter is required' })
    }

    const placeRepository = Container.getPlaceRepository()
    const place = await placeRepository.findById(id)

    if (!place) {
      return res.status(404).json({
        success: false,
        error: 'Place not found'
      })
    }

    return res.status(200).json({
      success: true,
      data: place
    })
  } catch (error) {
    console.error('Error fetching place:', error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    })
  }
})

/**
 * GET /places/search/within-polygon
 * Find places within city polygon boundaries
 */
controller.get('/search/within-polygon', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string)
    const lng = parseFloat(req.query.lng as string)

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        error: 'Valid latitude and longitude are required'
      })
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90' })
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180' })
    }

    const placeRepository = Container.getPlaceRepository()
    const places = await placeRepository.findPlacesWithinCityPolygon(lat, lng)

    return res.status(200).json({
      success: true,
      data: places,
      meta: {
        total: places.length,
        coordinates: { lat, lng }
      }
    })
  } catch (error) {
    console.error('Error searching places within polygon:', error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    })
  }
})

export default controller
