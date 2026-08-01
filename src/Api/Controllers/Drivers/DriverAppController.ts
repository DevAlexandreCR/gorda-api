import { Request, Response, Router } from 'express'
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
import { Store } from '../../../Services/store/Store'
import Service from '../../../Models/Service'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import ChatIdHelper from '../../../Helpers/ChatIdHelper'
import { resolveDriverCurrentVehicle } from '../../../Services/drivers/DriverVehicleResolver'
import { ServiceInterface } from '../../../Interfaces/ServiceInterface'
import { PlaceInterface } from '../../../Interfaces/PlaceInterface'
import { Metadata } from '../../../Interfaces/Metadata'

dayjs.extend(utc)
dayjs.extend(timezone)

const controller = Router()
const driverVehicleRepo = new DriverVehicleRepository()
const store = Store.getInstance()

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
  const requestedVehicleId = String(vehicle_id)
  const requestedSessionId = session_id ? String(session_id) : null

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
        vehicleId: requestedVehicleId,
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
        vehicleId: requestedVehicleId,
      })
    )
    return res.status(400).json({ error: 'vehicle_not_selectable' })
  }

  // Steps 4 & 5 — insert assignment in a transaction, then write RTDB presence
  const txn = await sequelize.transaction()
  try {
    type AssignmentSnapshot = {
      vehicle_id: string
      driver_id: string
      session_id: string | null
    }

    const loadRequestedVehicleAssignment = async (): Promise<AssignmentSnapshot | null> => {
      const record = await ActiveVehicleAssignmentRecord.findByPk(requestedVehicleId, {
        transaction: txn,
      })

      if (!record) return null

      const plain = record.get({ plain: true }) as AssignmentSnapshot
      return {
        vehicle_id: plain.vehicle_id,
        driver_id: plain.driver_id,
        session_id: plain.session_id ?? null,
      }
    }

    const loadDriverAssignment = async (): Promise<AssignmentSnapshot | null> => {
      const record = await ActiveVehicleAssignmentRecord.findOne({
        where: { driver_id: driverUid },
        transaction: txn,
      })

      if (!record) return null

      const plain = record.get({ plain: true }) as AssignmentSnapshot
      return {
        vehicle_id: plain.vehicle_id,
        driver_id: plain.driver_id,
        session_id: plain.session_id ?? null,
      }
    }

    const refreshRequestedVehicleSession = async (): Promise<void> => {
      await ActiveVehicleAssignmentRecord.update(
        { session_id: requestedSessionId },
        {
          where: {
            vehicle_id: requestedVehicleId,
            driver_id: driverUid,
          },
          transaction: txn,
        }
      )

      console.log(
        JSON.stringify({
          metric: 'connect.refreshed_existing_driver_assignment',
          driverId: driverUid,
          vehicleId: requestedVehicleId,
        })
      )
    }

    const rejectVehicleInUse = async (
      heldAssignment: AssignmentSnapshot | null
    ): Promise<Response> => {
      await txn.rollback()

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
          vehicleId: requestedVehicleId,
          heldByDriverId: heldAssignment?.driver_id ?? null,
        })
      )
      return res.status(409).json({ error: 'vehicle_in_use', held_by: heldBy })
    }

    const rejectDriverAlreadyConnected = async (): Promise<Response> => {
      console.log(
        JSON.stringify({
          metric: 'connect.rejected.driver_already_connected',
          driverId: driverUid,
        })
      )
      await txn.rollback()
      return res.status(409).json({ error: 'driver_already_connected' })
    }

    let acquired = await ActiveVehicleAssignmentRepository.tryAcquire(
      driverUid,
      requestedVehicleId,
      requestedSessionId,
      txn
    )

    if (!acquired) {
      const requestedAssignment = await loadRequestedVehicleAssignment()

      if (requestedAssignment) {
        if (requestedAssignment.driver_id !== driverUid) {
          return rejectVehicleInUse(requestedAssignment)
        }

        await refreshRequestedVehicleSession()
      } else {
        const existingAssignment = await loadDriverAssignment()

        if (!existingAssignment) {
          return rejectDriverAlreadyConnected()
        }

        if (existingAssignment.vehicle_id === requestedVehicleId) {
          await refreshRequestedVehicleSession()
        } else {
          await ActiveVehicleAssignmentRecord.destroy({
            where: { driver_id: driverUid },
            transaction: txn,
          })

          console.log(
            JSON.stringify({
              metric: 'connect.cleaned_stale_driver_assignment',
              driverId: driverUid,
              oldVehicleId: existingAssignment.vehicle_id,
              newVehicleId: requestedVehicleId,
            })
          )

          acquired = await ActiveVehicleAssignmentRepository.tryAcquire(
            driverUid,
            requestedVehicleId,
            requestedSessionId,
            txn
          )

          if (!acquired) {
            const concurrentRequestedAssignment = await loadRequestedVehicleAssignment()

            if (concurrentRequestedAssignment) {
              if (concurrentRequestedAssignment.driver_id !== driverUid) {
                return rejectVehicleInUse(concurrentRequestedAssignment)
              }

              await refreshRequestedVehicleSession()
            } else {
              return rejectDriverAlreadyConnected()
            }
          }
        }
      }
    }

    // Step 5 — write RTDB presence before committing
    try {
      await DatabaseService.dbConnectedDrivers()
        .child(driverUid)
        .set({
          id: driverUid,
          vehicle_id: requestedVehicleId,
          vehicle_plate: vehiclePlain.plate,
          session_id: requestedSessionId,
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
      JSON.stringify({
        metric: 'connect.success',
        driverId: driverUid,
        vehicleId: requestedVehicleId,
      })
    )
    return res.status(200).json({ success: true, data: {} })
  } catch (err) {
    await txn.rollback()
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

// A deferred payload carries the app-reported clock for a self-service trip that already
// finished offline (see design.md D5): `created_at`/`start_trip_at` are always required,
// plus either termination fields (status='terminated') or nothing else (status='canceled').
// Bounds: no reported timestamp may exceed the sync request's arrival time, and ordering
// must be created_at <= start_trip_at < end_trip_at. Violations are rejected, nothing written.
type DeferredPlan = {
  createdAt: number
  startTripAt: number
  status: string
  endTripAt?: number
  tripFee?: number
  tripDistance?: number
  route?: string | null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateDeferredPayload(
  body: any,
  requestReceivedAt: number
): { ok: true; plan: DeferredPlan } | { ok: false; reason: string } {
  const createdAt = Number(body?.created_at)
  const startTripAt = Number(body?.start_trip_at)
  const status = body?.status

  if (!isFiniteNumber(createdAt) || createdAt <= 0) {
    return { ok: false, reason: 'invalid_created_at' }
  }
  if (!isFiniteNumber(startTripAt) || startTripAt <= 0) {
    return { ok: false, reason: 'invalid_start_trip_at' }
  }
  if (status !== Service.STATUS_TERMINATED && status !== Service.STATUS_CANCELED) {
    return { ok: false, reason: 'invalid_status' }
  }
  if (createdAt > requestReceivedAt || startTripAt > requestReceivedAt) {
    return { ok: false, reason: 'timestamp_exceeds_arrival_time' }
  }
  if (createdAt > startTripAt) {
    return { ok: false, reason: 'invalid_timestamp_order' }
  }

  if (status === Service.STATUS_CANCELED) {
    return { ok: true, plan: { createdAt, startTripAt, status } }
  }

  const endTripAt = Number(body?.end_trip_at)
  const tripFee = Number(body?.trip_fee)
  const tripDistance = Number(body?.trip_distance)
  const route = body?.route != null ? String(body.route) : null

  if (!isFiniteNumber(endTripAt) || endTripAt <= 0) {
    return { ok: false, reason: 'invalid_end_trip_at' }
  }
  if (endTripAt > requestReceivedAt) {
    return { ok: false, reason: 'timestamp_exceeds_arrival_time' }
  }
  if (startTripAt >= endTripAt) {
    return { ok: false, reason: 'invalid_timestamp_order' }
  }
  if (!isFiniteNumber(tripFee) || tripFee < 0) {
    return { ok: false, reason: 'invalid_trip_fee' }
  }
  if (!isFiniteNumber(tripDistance) || tripDistance < 0) {
    return { ok: false, reason: 'invalid_trip_distance' }
  }

  return {
    ok: true,
    plan: { createdAt, startTripAt, status, endTripAt, tripFee, tripDistance, route },
  }
}

controller.post('/me/services', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  const requestReceivedAt = dayjs().unix()
  const { location, trip_multiplier } = req.body
  const isDeferred = req.body?.deferred === true
  const lat = location?.lat
  const lng = location?.lng
  const tripMultiplier = Number(trip_multiplier)

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return res.status(400).json({
      success: false,
      message: 'location.lat/lng are required and must be valid coordinates',
      data: {},
    })
  }

  if (!Number.isFinite(tripMultiplier) || tripMultiplier < 1.0) {
    return res.status(400).json({
      success: false,
      message: 'trip_multiplier is required and must be a number >= 1.0',
      data: {},
    })
  }

  // Deferred payloads describe a trip that already ran (and possibly finished) offline: they
  // skip presence/availability/busy checks entirely — the ride happened regardless of the
  // driver's current state — and are validated/rejected before anything else runs.
  let deferredPlan: DeferredPlan | null = null
  if (isDeferred) {
    const validation = validateDeferredPayload(req.body, requestReceivedAt)
    if (!validation.ok) {
      console.log(
        JSON.stringify({
          metric: 'self_service.rejected.malformed_deferred_payload',
          driverId: driverUid,
          reason: validation.reason,
        })
      )
      return res
        .status(400)
        .json({ error: 'malformed_deferred_payload', reason: validation.reason })
    }
    deferredPlan = validation.plan
  }

  // Step 1 — driver must be currently connected (presence) — online creations only
  if (!isDeferred) {
    const presenceSnapshot = await DatabaseService.dbConnectedDrivers().child(driverUid).get()
    if (!presenceSnapshot.exists()) {
      console.log(
        JSON.stringify({
          metric: 'self_service.rejected.driver_not_connected',
          driverId: driverUid,
        })
      )
      return res.status(403).json({ error: 'driver_not_connected' })
    }
  }

  // Step 2 — load the driver record (name/phone are needed for the record in both modes;
  // the enabled check below only applies to online creations)
  const driver = await DriverRecord.findByPk(driverUid)
  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found', data: {} })
  }
  const driverPlain = driver.get({ plain: true }) as any

  if (!isDeferred) {
    if (!driverPlain.enabled_at || Number(driverPlain.enabled_at) <= 0) {
      console.log(
        JSON.stringify({ metric: 'self_service.rejected.driver_disabled', driverId: driverUid })
      )
      return res.status(403).json({ error: 'driver_disabled' })
    }

    // Step 3 — monthly drivers always pass, percentage drivers need a positive balance
    const paymentMode = driverPlain.paymentMode ?? 'monthly'
    const balance = Number(driverPlain.balance ?? 0)
    if (paymentMode === 'percentage' && balance <= 0) {
      console.log(
        JSON.stringify({
          metric: 'self_service.rejected.negative_balance_percentage',
          driverId: driverUid,
        })
      )
      return res.status(403).json({ error: 'negative_balance_percentage' })
    }

    // Step 4 — driver must not already be busy with a current or queued service
    const [assignedSnapshot, connectionSnapshot] = await Promise.all([
      DatabaseService.dbDriversAssigned().child(driverUid).get(),
      DatabaseService.dbServiceConnections().child(driverUid).get(),
    ])
    if (assignedSnapshot.exists() || connectionSnapshot.exists()) {
      console.log(
        JSON.stringify({
          metric: 'self_service.rejected.driver_already_in_service',
          driverId: driverUid,
        })
      )
      return res.status(409).json({ error: 'driver_already_in_service' })
    }
  }

  // Step 5 — resolve the default branch/city for start_loc
  let branchCity: { branchId: string; cityId: string }
  try {
    branchCity = store.getDefaultBranchCity()
  } catch (error) {
    console.error('Error resolving default branch/city for self-service trip:', error)
    return res.status(500).json({
      success: false,
      message: 'No default branch/city configured for self-service trips',
      data: {},
    })
  }

  // Step 6 — build and write the service record, pointer (online only), and vehicle snapshot
  try {
    const clientId = ChatIdHelper.toCanonicalClientId(driverPlain.phone)

    // service_history.client_id is a foreign key into clients — for admin/bot services that
    // row already exists (created when the customer first messaged the bot or was registered
    // in the panel). A self-service trip has no such customer, so it must upsert the driver's
    // own pseudo-client row here or the eventual history finalize will fail with an FK violation.
    await Container.getClientRepository().store({
      id: clientId,
      name: driverPlain.name,
      phone: driverPlain.phone,
    })

    const startLoc: PlaceInterface = {
      id: '',
      name: 'Self service trip',
      lat,
      lng,
      location: null,
      cityId: branchCity.cityId,
      city: branchCity.cityId,
      country: branchCity.branchId,
    }

    // Online creations are server-stamped (the API controls the moment of creation);
    // deferred payloads carry the app-reported clock so history reflects when the ride
    // actually happened (design.md D5).
    const createdAt = isDeferred ? (deferredPlan as DeferredPlan).createdAt : requestReceivedAt
    const startTripAt = isDeferred ? (deferredPlan as DeferredPlan).startTripAt : requestReceivedAt

    const initialMetadata: Metadata = {
      start_trip_at: startTripAt,
      trip_multiplier: tripMultiplier,
    }

    const service: ServiceInterface = {
      id: null,
      status: Service.STATUS_IN_PROGRESS,
      start_loc: startLoc,
      end_loc: null,
      phone: driverPlain.phone,
      name: driverPlain.name,
      comment: '',
      amount: null,
      metadata: initialMetadata,
      driver_id: driverUid,
      client_id: clientId,
      wp_client_id: Service.WP_CLIENT_ID_DRIVER_APP,
      created_at: createdAt,
      origin: Service.ORIGIN_DRIVER,
      directed_to: driverUid,
    }

    const created = await ServiceRepository.create(service)
    const serviceId = created.id as string

    // Deferred syncs of already-finished trips skip the drivers_assigned pointer entirely
    // (design.md D2) — the trip is not "current" for anyone by the time it syncs.
    if (!isDeferred) {
      await DatabaseService.dbDriversAssigned().child(driverUid).set(serviceId)
    }

    try {
      const vehicle = await resolveDriverCurrentVehicle(driverUid)
      if (vehicle) {
        await DatabaseService.dbServices()
          .child(serviceId)
          .child('vehicle')
          .set({
            plate: vehicle.plate,
            brand: vehicle.brand ?? null,
            model: vehicle.model ?? null,
            color: vehicle.color ?? null,
          })
      }
    } catch (vehicleError) {
      console.error('Error writing vehicle snapshot for self-service trip:', vehicleError)
    }

    if (isDeferred) {
      const plan = deferredPlan as DeferredPlan

      // Applied as a single second write (after the in_progress create above) so the
      // existing services/{id}/status onUpdate trigger fires normally — settlement, history
      // finalize, and pointer cleanup. Creating the record directly in a terminal state
      // would silently skip all of that (design.md D5).
      let finalMetadata: Metadata
      if (plan.status === Service.STATUS_TERMINATED) {
        // Mirrors exactly what the driver app writes on a normal termination:
        // metadata{end_trip_at, route, trip_distance, trip_fee, trip_multiplier}.
        finalMetadata = {
          ...initialMetadata,
          end_trip_at: plan.endTripAt,
          route: plan.route ?? null,
          trip_distance: Math.round(plan.tripDistance as number),
          trip_fee: plan.tripFee === 0 ? null : plan.tripFee,
          trip_multiplier: tripMultiplier,
        }
      } else {
        finalMetadata = { ...initialMetadata, deferred: true }
      }

      await DatabaseService.dbServices().child(serviceId).update({
        metadata: finalMetadata,
        status: plan.status,
      })

      created.status = plan.status
      created.metadata = finalMetadata

      console.log(
        JSON.stringify({
          metric: `self_service.deferred_${plan.status}`,
          driverId: driverUid,
          serviceId,
        })
      )
    } else {
      console.log(
        JSON.stringify({ metric: 'self_service.created', driverId: driverUid, serviceId })
      )
    }

    return res.status(200).json({ success: true, data: { service: created } })
  } catch (error) {
    console.error('Error creating self-service trip:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.post('/me/services/:id/cancel', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  const serviceId = req.params.id

  let service: ServiceInterface
  try {
    service = await ServiceRepository.findServiceById(serviceId)
  } catch (error) {
    return res.status(404).json({ error: 'service_not_found' })
  }

  if (service.origin !== Service.ORIGIN_DRIVER) {
    console.log(
      JSON.stringify({
        metric: 'self_service.cancel.rejected.not_self_service',
        driverId: driverUid,
        serviceId,
      })
    )
    return res.status(403).json({ error: 'not_self_service' })
  }

  if (service.driver_id !== driverUid) {
    console.log(
      JSON.stringify({
        metric: 'self_service.cancel.rejected.not_owner',
        driverId: driverUid,
        serviceId,
      })
    )
    return res.status(403).json({ error: 'not_owner' })
  }

  if (service.status !== Service.STATUS_IN_PROGRESS) {
    console.log(
      JSON.stringify({
        metric: 'self_service.cancel.rejected.invalid_status',
        driverId: driverUid,
        serviceId,
        status: service.status,
      })
    )
    return res.status(409).json({ error: 'invalid_status' })
  }

  const startTripAt = Number(service.metadata?.start_trip_at)
  if (!Number.isFinite(startTripAt) || startTripAt <= 0) {
    console.error('Self-service cancel: service missing metadata.start_trip_at', { serviceId })
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }

  // Same accessor the public ride-fees snapshot uses, so the app-visible window and the
  // server-enforced one always agree (design.md D6) — never hardcode the window here.
  let cancelWindow: number
  try {
    const rideFees = await Container.getMasterDataRepository().buildPricingSnapshot()
    cancelWindow = Number(rideFees.self_service_cancel_window)
  } catch (error) {
    console.error('Error resolving self-service cancel window:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }

  const now = dayjs().unix()
  if (now - startTripAt > cancelWindow) {
    console.log(
      JSON.stringify({
        metric: 'self_service.cancel.rejected.cancel_window_elapsed',
        driverId: driverUid,
        serviceId,
        elapsed: now - startTripAt,
        cancelWindow,
      })
    )
    return res.status(409).json({ error: 'cancel_window_elapsed' })
  }

  try {
    // Reuses the existing status-update path so the services/{id}/status onUpdate trigger
    // fires normally (pointer cleanup, no charge) — do not stamp metadata.deferred here,
    // that flag is exclusive to the deferred-sync path (design.md D5).
    await ServiceRepository.updateStatus(serviceId, Service.STATUS_CANCELED)
    console.log(
      JSON.stringify({ metric: 'self_service.cancel.success', driverId: driverUid, serviceId })
    )
    return res.status(200).json({ success: true, data: {} })
  } catch (error) {
    console.error('Error canceling self-service trip:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.put('/me/location', async (req: Request, res: Response) => {
  const { driverUid } = req as DriverAuthenticatedRequest

  if (!driverUid) {
    return res
      .status(401)
      .json({ success: false, message: 'Driver authentication required', data: {} })
  }

  const { session_id, location } = req.body
  const requestedSessionId = session_id ? String(session_id) : null
  const lat = location?.lat
  const lng = location?.lng

  if (!requestedSessionId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({
      success: false,
      message: 'session_id and location.lat/lng are required',
      data: {},
    })
  }

  // A heartbeat must never create or resurrect a presence node: absent node → 410,
  // mismatched session (stale app instance) → 409, otherwise merge location + last_seen_at.
  let outcome: 'not_connected' | 'session_superseded' | 'updated' = 'not_connected'

  try {
    await DatabaseService.dbConnectedDrivers()
      .child(driverUid)
      .transaction((current) => {
        if (!current) {
          outcome = 'not_connected'
          return undefined
        }

        if (current.session_id !== requestedSessionId) {
          outcome = 'session_superseded'
          return undefined
        }

        outcome = 'updated'
        return {
          ...current,
          location: { lat, lng },
          last_seen_at: Date.now(),
        }
      })
  } catch (error) {
    console.error('Error during driver location heartbeat:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }

  if (outcome === 'not_connected') {
    return res.status(410).json({ error: 'not_connected' })
  }

  if (outcome === 'session_superseded') {
    return res.status(409).json({ error: 'session_superseded' })
  }

  return res.status(200).json({ success: true, data: {} })
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
