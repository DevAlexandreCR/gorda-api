import { Request, Response, Router } from "express"
import Container from "../../../Container/Container"
import { validateRequest } from "../../../Middlewares/ValidateRequest"
import { requireAuth } from "../../../Middlewares/Authorization"
import {
  IndexPlacesRequest,
  StorePlaceRequest,
  ShowPlaceRequest,
  SearchWithinPolygonRequest
} from "../../Requests/Places"

const controller = Router()

controller.use(requireAuth)

controller.get('/', validateRequest(IndexPlacesRequest), async (req: Request, res: Response) => {
  try {
    const { cityId } = req.query as { cityId: string }

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

controller.post('/', validateRequest(StorePlaceRequest), async (req: Request, res: Response) => {
  try {
    const { name, lat, lng, cityId } = req.body

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

controller.get('/:id', validateRequest(ShowPlaceRequest), async (req: Request, res: Response) => {
  try {
    const { id } = req.params

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

controller.get('/search/within-polygon', validateRequest(SearchWithinPolygonRequest), async (req: Request, res: Response) => {
  try {
    const { lat, lng } = req.query as unknown as { lat: number, lng: number }

    const placeRepository = Container.getPlaceRepository()
    const places = await placeRepository.findPlacesWithinCityPolygon('popayan')

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
