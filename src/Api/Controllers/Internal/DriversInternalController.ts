import { Request, Response, Router } from 'express'
import DriverRecord from '../../../Models/DriverRecord'
import ActiveVehicleAssignmentRepository from '../../../Repositories/ActiveVehicleAssignmentRepository'
import VehicleRepository from '../../../Repositories/VehicleRepository'
import { requireInternalAuth } from '../../../Middlewares/Authorization'

const controller = Router()
const vehicleRepo = new VehicleRepository()

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

    const assignment = await ActiveVehicleAssignmentRepository.findByDriver(driverId)
    if (assignment) {
      const vehicle = await vehicleRepo.findById(assignment.vehicle_id)
      if (vehicle) {
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
      }
    }

    const driverRaw = await DriverRecord.findByPk(driverId)
    if (!driverRaw) {
      return res.status(200).json({ success: true, data: { vehicle_id: null } })
    }

    const selectedVehicleId = (driverRaw.get({ plain: true }) as any)?.selected_vehicle_id ?? null
    if (!selectedVehicleId) {
      return res.status(200).json({ success: true, data: { vehicle_id: null } })
    }

    const vehicle = await vehicleRepo.findById(selectedVehicleId)
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
