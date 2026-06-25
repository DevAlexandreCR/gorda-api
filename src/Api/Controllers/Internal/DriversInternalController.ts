import { Request, Response, Router } from 'express'
import { requireInternalAuth } from '../../../Middlewares/Authorization'
import { resolveDriverCurrentVehicle } from '../../../Services/drivers/DriverVehicleResolver'

const controller = Router()

controller.use(requireInternalAuth)

controller.get('/:id/active-vehicle', async (req: Request, res: Response) => {
  try {
    const driverId = String(req.params.id ?? '').trim()

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'driver id is required',
        data: {},
      })
    }

    const vehicle = await resolveDriverCurrentVehicle(driverId)

    if (!vehicle) {
      return res.status(200).json({ success: true, data: { vehicle_id: null } })
    }

    return res.status(200).json({
      success: true,
      data: {
        vehicle_id: vehicle.id,
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
      },
    })
  } catch (error) {
    console.error('Error fetching driver active vehicle:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
