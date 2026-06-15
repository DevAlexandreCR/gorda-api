import { Request, Response, Router } from 'express'
import { UniqueConstraintError } from 'sequelize'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Container from '../../../Container/Container'
import { DriverAuthenticatedRequest, requireDriverAuth } from '../../../Middlewares/Authorization'
import DriverRecord from '../../../Models/DriverRecord'
import VehicleRecord from '../../../Models/VehicleRecord'
import ActiveVehicleAssignmentRecord from '../../../Models/ActiveVehicleAssignmentRecord'
import ActiveVehicleAssignmentRepository from '../../../Repositories/ActiveVehicleAssignmentRepository'
import DriverVehicleRepository from '../../../Repositories/DriverVehicleRepository'
import DatabaseService from '../../../Services/firebase/Database'
import sequelize from '../../../Database/sequelize'

dayjs.extend(utc)
dayjs.extend(timezone)

const controller = Router()
const driverVehicleRepo = new DriverVehicleRepository()

controller.use(requireDriverAuth)

controller.get('/me/history', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res.status(401).json({
      success: false,
      message: 'Driver authentication required',
      data: {},
    })
  }

  try {
    const startOfToday = dayjs().tz('America/Bogota').startOf('day').unix()
    const endOfToday = dayjs().tz('America/Bogota').endOf('day').unix()
    const from = Number(req.query.from ?? startOfToday)
    const to = Number(req.query.to ?? endOfToday)
    const services = await Container.getServiceHistoryRepository().listByDriver(driverUid, {
      from,
      to,
    })

    return res.status(200).json({
      success: true,
      data: { services },
    })
  } catch (error) {
    console.error('Error fetching driver history:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.put('/me/token', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest
  const token = String(req.body?.token ?? '').trim()

  if (!driverUid) {
    return res.status(401).json({
      success: false,
      message: 'Driver authentication required',
      data: {},
    })
  }

  if (!token) {
    return res.status(400).json({
      success: false,
      message: 'Token is required',
      data: {},
    })
  }

  try {
    const driverToken = await Container.getDriverTokenRecordRepository().upsert(driverUid, token)
    return res.status(200).json({
      success: true,
      data: { driverToken },
    })
  } catch (error) {
    console.error('Error upserting driver token:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.delete('/me/token', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res.status(401).json({
      success: false,
      message: 'Driver authentication required',
      data: {},
    })
  }

  try {
    await Container.getDriverTokenRecordRepository().deleteByDriverId(driverUid)
    return res.status(200).json({
      success: true,
      data: {},
    })
  } catch (error) {
    console.error('Error deleting driver token:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/me/connect', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  const { vehicle_id, session_id, location } = req.body

  if (!vehicle_id) {
    return res.status(400).json({ success: false, message: 'vehicle_id is required', data: {} })
  }

  // Step 1 — verify driver is enabled
  const driver = await DriverRecord.findByPk(driverUid)
  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found', data: {} })
  }
  const driverPlain = driver.get({ plain: true }) as any
  if (!driverPlain.enabled_at || Number(driverPlain.enabled_at) <= 0) {
    console.log(JSON.stringify({ metric: 'connect.rejected.driver_disabled', driverId: driverUid }))
    return res.status(403).json({ error: 'driver_disabled' })
  }

  // Step 2 — verify vehicle exists and is enabled
  const vehicle = await VehicleRecord.findByPk(vehicle_id)
  if (!vehicle) {
    return res.status(404).json({ success: false, message: 'Vehicle not found', data: {} })
  }
  const vehiclePlain = vehicle.get({ plain: true }) as any
  if (!vehiclePlain.enabled) {
    console.log(
      JSON.stringify({
        metric: 'connect.rejected.vehicle_disabled',
        driverId: driverUid,
        vehicleId: vehicle_id,
      })
    )
    return res.status(400).json({ error: 'vehicle_disabled' })
  }

  // Step 3 — verify driver-vehicle link exists and is selectable
  const links = await driverVehicleRepo.listForDriver(driverUid, { includeAll: true })
  const link = links.find((l) => l.vehicle_id === String(vehicle_id))
  if (!link || !link.selectable) {
    console.log(
      JSON.stringify({
        metric: 'connect.rejected.vehicle_not_selectable',
        driverId: driverUid,
        vehicleId: vehicle_id,
      })
    )
    return res.status(400).json({ error: 'vehicle_not_selectable' })
  }

  // Steps 4 & 5 — insert assignment in a transaction, then write RTDB presence
  const txn = await sequelize.transaction()
  try {
    await ActiveVehicleAssignmentRecord.create(
      {
        vehicle_id: String(vehicle_id),
        driver_id: driverUid,
        session_id: session_id ? String(session_id) : null,
      },
      { transaction: txn }
    )

    // Step 5 — write RTDB presence before committing
    try {
      await DatabaseService.dbConnectedDrivers()
        .child(driverUid)
        .set({
          id: driverUid,
          vehicle_id: String(vehicle_id),
          session_id: session_id ? String(session_id) : null,
          location: location ?? null,
          last_seen_at: Date.now(),
        })
    } catch (rtdbErr) {
      await txn.rollback()
      console.error('RTDB write failed during connect:', rtdbErr)
      return res.status(503).json({ error: 'presence_unavailable' })
    }

    await txn.commit()
    console.log(
      JSON.stringify({ metric: 'connect.success', driverId: driverUid, vehicleId: vehicle_id })
    )
    return res.status(200).json({ success: true, data: {} })
  } catch (err) {
    await txn.rollback()
    if (err instanceof UniqueConstraintError) {
      const constraint = (err as any).parent?.constraint
      if (constraint === 'active_vehicle_assignments_pkey') {
        // Vehicle is already held by another driver — find who holds it
        const heldAssignment = await ActiveVehicleAssignmentRepository.findByVehicle(
          String(vehicle_id)
        )
        let heldBy: { id: string; name: string } | null = null
        if (heldAssignment) {
          const holderDriver = await DriverRecord.findByPk(heldAssignment.driver_id)
          if (holderDriver) {
            const holderPlain = holderDriver.get({ plain: true }) as any
            heldBy = { id: holderPlain.id, name: holderPlain.name }
          }
        }
        console.log(
          JSON.stringify({
            metric: 'connect.rejected.vehicle_in_use',
            driverId: driverUid,
            vehicleId: vehicle_id,
          })
        )
        return res.status(409).json({ error: 'vehicle_in_use', held_by: heldBy })
      } else if (constraint === 'active_vehicle_assignments_driver_id_key') {
        console.log(
          JSON.stringify({
            metric: 'connect.rejected.driver_already_connected',
            driverId: driverUid,
          })
        )
        return res.status(409).json({ error: 'driver_already_connected' })
      }
    }
    console.error('Error during driver connect:', err)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.post('/me/disconnect', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  try {
    await ActiveVehicleAssignmentRepository.releaseByDriver(driverUid)
    await DatabaseService.dbConnectedDrivers().child(driverUid).remove()
    return res.status(200).json({ success: true, data: {} })
  } catch (error) {
    console.error('Error during driver disconnect:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.get('/me/vehicles', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  try {
    const vehicles = await driverVehicleRepo.listForDriver(driverUid, { includeAll: false })
    const driverRaw = await DriverRecord.findByPk(driverUid)
    const selectedVehicleId = (driverRaw?.get({ plain: true }) as any)?.selected_vehicle_id ?? null
    const assignment = await ActiveVehicleAssignmentRepository.findByDriver(driverUid)

    const result = vehicles.map((v) => ({
      ...v.vehicle,
      vehicle_id: v.vehicle_id,
      selectable: v.selectable,
      is_selectable: v.selectable,
      is_selected: v.vehicle_id === selectedVehicleId,
      is_active: assignment?.vehicle_id === v.vehicle_id,
    }))

    return res.status(200).json({ success: true, data: { vehicles: result } })
  } catch (error) {
    console.error('Error fetching driver vehicles:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.put('/me/selected-vehicle', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  const { vehicle_id } = req.body

  if (!vehicle_id) {
    return res.status(400).json({ success: false, message: 'vehicle_id is required', data: {} })
  }

  try {
    const eligibleLinks = await driverVehicleRepo.findEligibleForDriver(driverUid)
    const isEligible = eligibleLinks.some((link) => link.vehicle_id === String(vehicle_id))
    if (!isEligible) {
      return res.status(400).json({ error: 'vehicle_not_eligible' })
    }

    await DriverRecord.update({ selected_vehicle_id: String(vehicle_id) } as any, {
      where: { id: driverUid },
    })

    return res.status(200).json({ success: true, data: {} })
  } catch (error) {
    console.error('Error updating selected vehicle:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

export default controller
