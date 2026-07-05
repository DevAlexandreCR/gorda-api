import { Request, Response, Router } from 'express'
import { UniqueConstraintError } from 'sequelize'
import dayjs from 'dayjs'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { DriverInterface } from '../../../Interfaces/DriverInterface'
import { Store } from '../../../Services/store/Store'
import { DriverListQuery } from '../../../Repositories/DriverRecordRepository'
import DriverRepository from '../../../Repositories/DriverRepository'
import { VehicleRecordInterface } from '../../../Interfaces/VehicleRecordInterface'
import FCM from '../../../Services/firebase/FCM'
import { FCMNotification } from '../../../Types/FCMNotifications'
import DriverVehicleRepository from '../../../Repositories/DriverVehicleRepository'
import VehicleRepository from '../../../Repositories/VehicleRepository'
import ActiveVehicleAssignmentRepository from '../../../Repositories/ActiveVehicleAssignmentRepository'
import DriverRecord from '../../../Models/DriverRecord'
import sequelize from '../../../Database/sequelize'
import { autoPromoteSelectedVehicle } from '../../../Services/drivers/AutoPromoteVehicle'
import { forceDisconnect } from '../../../Services/drivers/ForceDisconnect'
import { currentPeriod, PERIOD_FORMAT } from '../../../Services/time/BogotaTime'

const controller = Router()
const publicController = Router()
const store = Store.getInstance()
const driverVehicleRepo = new DriverVehicleRepository()
const vehicleRepo = new VehicleRepository()

type MobileDriverVehicle = Pick<
  VehicleRecordInterface,
  'id' | 'plate' | 'brand' | 'model' | 'photoUrl' | 'color' | 'enabled'
> & {
  is_selected: boolean
  is_selectable: boolean
  is_active: boolean
}

function toMobileDriverVehicle(
  vehicle: VehicleRecordInterface,
  options: {
    selectedVehicleId: string | null
    isSelectable: boolean
    activeVehicleId: string | null
  }
): MobileDriverVehicle {
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    brand: vehicle.brand ?? null,
    model: vehicle.model ?? null,
    photoUrl: vehicle.photoUrl ?? null,
    color: vehicle.color ?? null,
    enabled: Boolean(vehicle.enabled),
    is_selected: vehicle.id === options.selectedVehicleId,
    is_selectable: options.isSelectable && Boolean(vehicle.enabled),
    is_active: vehicle.id === options.activeVehicleId,
  }
}

controller.use(requireAuth)

const LISTED_PARAMS = [
  'search',
  'status',
  'paymentMode',
  'paymentStatus',
  'period',
  'inactiveDays',
  'sort',
  'page',
  'perPage',
]
const ALLOWED_PER_PAGE = [20, 30, 50]
const PAYMENT_STATUSES = ['paid', 'pending']

controller.get('/', async (req: Request, res: Response) => {
  const hasListedParams = LISTED_PARAMS.some((p) => req.query[p] !== undefined)

  if (!hasListedParams) {
    try {
      const drivers = await Container.getDriverRecordRepository().index()
      return res.status(200).json({
        success: true,
        data: { drivers, total: drivers.length },
      })
    } catch (error) {
      console.error('Error fetching drivers:', error)
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        data: {},
      })
    }
  }

  try {
    const { search, status, paymentMode, paymentStatus, period, inactiveDays, sort, page, perPage } =
      req.query

    if (perPage !== undefined) {
      const perPageNum = Number(perPage)
      if (!ALLOWED_PER_PAGE.includes(perPageNum)) {
        return res.status(400).json({
          success: false,
          message: `Invalid perPage value. Allowed values: ${ALLOWED_PER_PAGE.join(', ')}`,
          data: {},
        })
      }
    }

    let paymentStatusValue: 'paid' | 'pending' | undefined
    if (paymentStatus !== undefined && String(paymentStatus) !== '') {
      const paymentStatusStr = String(paymentStatus)
      if (!PAYMENT_STATUSES.includes(paymentStatusStr)) {
        return res.status(400).json({
          success: false,
          message: `Invalid paymentStatus value. Allowed values: ${PAYMENT_STATUSES.join(', ')}`,
          data: {},
        })
      }
      paymentStatusValue = paymentStatusStr as 'paid' | 'pending'
    }

    let periodValue: string | undefined
    if (paymentStatusValue !== undefined && period !== undefined && String(period) !== '') {
      const periodStr = String(period)
      if (!PERIOD_FORMAT.test(periodStr)) {
        return res.status(400).json({
          success: false,
          message: 'period must match the format YYYY-MM',
          data: {},
        })
      }
      periodValue = periodStr
    }

    const pageNum = Math.max(1, parseInt(String(page ?? '1'), 10) || 1)

    const query: DriverListQuery = {
      search: search !== undefined ? String(search) : undefined,
      status: status !== undefined ? String(status) : undefined,
      paymentMode: paymentMode !== undefined ? String(paymentMode) : undefined,
      paymentStatus: paymentStatusValue,
      period: periodValue,
      inactiveDays: inactiveDays !== undefined ? Number(inactiveDays) : undefined,
      sort: sort !== undefined ? String(sort) : undefined,
      page: pageNum,
      perPage: perPage !== undefined ? Number(perPage) : undefined,
    }

    const { rows, total } = await Container.getDriverRecordRepository().list(query)
    return res.status(200).json({
      success: true,
      data: { drivers: rows, total },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    if (message.startsWith('Invalid sort field')) {
      return res.status(400).json({ success: false, message, data: {} })
    }
    console.error('Error fetching drivers:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/bulk/enable', async (req: Request, res: Response) => {
  const { driverIds } = req.body
  if (!Array.isArray(driverIds) || driverIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'driverIds must be a non-empty array',
      data: {},
    })
  }

  try {
    const enabledAt = Math.floor(Date.now() / 1000)
    const result = await Container.getDriverRecordRepository().bulkSetEnabled(driverIds, enabledAt)
    await store.refreshDrivers()
    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    console.error('Error bulk enabling drivers:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/bulk/disable', async (req: Request, res: Response) => {
  const { driverIds } = req.body
  if (!Array.isArray(driverIds) || driverIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'driverIds must be a non-empty array',
      data: {},
    })
  }

  try {
    const result = await Container.getDriverRecordRepository().bulkSetEnabled(driverIds, 0)

    await Promise.allSettled(driverIds.map((id) => DriverRepository.removeDriver(id)))

    await store.refreshDrivers()
    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    console.error('Error bulk disabling drivers:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/bulk/send-message', async (req: Request, res: Response) => {
  const { driverIds, title, body, data } = req.body
  if (!Array.isArray(driverIds) || driverIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'driverIds must be a non-empty array',
      data: {},
    })
  }

  const message: FCMNotification = {
    title: String(title ?? ''),
    body: String(body ?? ''),
    data: data !== undefined ? data : undefined,
  }

  const payload: FCMNotification = {
    title: message.title || 'New Message',
    body: message.body || 'You have a new message',
    data: {
      ...message.data,
      title: message.title || 'New Message',
      body: message.body || 'You have a new message',
      type: 'alert',
    },
  }

  const processed: string[] = []
  const failed: { id: string; reason: string }[] = []

  await Promise.allSettled(
    driverIds.map(async (id: string) => {
      try {
        const driverToken = await Container.getDriverTokenRecordRepository().findByDriverId(id)
        if (!driverToken) {
          failed.push({ id, reason: 'Driver token not found' })
          return
        }
        await FCM.sendNotificationTo(driverToken.token, payload)
        processed.push(id)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        failed.push({ id, reason })
      }
    })
  )

  return res.status(200).json({ success: true, data: { processed, failed } })
})

controller.get('/monthly-payment-settings', async (req: Request, res: Response) => {
  try {
    const settings = await Container.getMonthlyPaymentSettingsRepository().get()
    return res.status(200).json({ success: true, data: settings })
  } catch (error) {
    console.error('Error fetching monthly payment settings:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.put('/monthly-payment-settings', async (req: Request, res: Response) => {
  const { suggested_amount, auto_disable, cutoff_day, reminder_offsets } = req.body

  try {
    const settings = await Container.getMonthlyPaymentSettingsRepository().upsert({
      suggested_amount,
      auto_disable,
      cutoff_day,
      reminder_offsets,
    })
    return res.status(200).json({ success: true, data: settings })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    if (message.startsWith('Invalid')) {
      return res.status(400).json({ success: false, message, data: {} })
    }
    console.error('Error updating monthly payment settings:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

// GET /:id/vehicles — list all linked vehicles for a driver
controller.get('/:id/vehicles', async (req: Request, res: Response) => {
  try {
    const driverId = req.params.id
    const driver = await Container.getDriverRecordRepository().findById(driverId)
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found', data: {} })
    }

    const links = await driverVehicleRepo.listForDriver(driverId, { includeAll: true })
    const activeAssignment = await ActiveVehicleAssignmentRepository.findByDriver(driverId)
    const driverRaw = await DriverRecord.findByPk(driverId)
    const selectedVehicleId = (driverRaw?.get({ plain: true }) as any)?.selected_vehicle_id ?? null

    const vehicles = links.map((link) => ({
      ...link,
      is_selected: link.vehicle_id === selectedVehicleId,
      is_active: activeAssignment !== null && activeAssignment.vehicle_id === link.vehicle_id,
    }))

    return res.status(200).json({ success: true, data: { vehicles } })
  } catch (error) {
    console.error('Error fetching driver vehicles:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

// POST /:id/vehicles — link a vehicle to a driver (by vehicleId or by vehicle payload)
controller.post('/:id/vehicles', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const { vehicleId, vehicle: vehiclePayload } = req.body

  if (!vehicleId && !vehiclePayload) {
    return res
      .status(400)
      .json({ success: false, message: 'vehicleId or vehicle payload required', data: {} })
  }

  const txn = await sequelize.transaction()
  try {
    const driver = await Container.getDriverRecordRepository().findById(driverId)
    if (!driver) {
      await txn.rollback()
      return res.status(404).json({ success: false, message: 'Driver not found', data: {} })
    }

    let resolvedVehicleId: string

    if (vehicleId) {
      resolvedVehicleId = String(vehicleId)
    } else {
      const { plate, brand, model, color, ...rest } = vehiclePayload
      if (!plate) {
        await txn.rollback()
        return res
          .status(400)
          .json({ success: false, message: 'vehicle.plate is required', data: {} })
      }
      if (!brand || typeof brand !== 'string' || String(brand).trim() === '') {
        await txn.rollback()
        return res
          .status(400)
          .json({ success: false, message: 'vehicle.brand is required', data: {} })
      }
      if (!model || typeof model !== 'string' || String(model).trim() === '') {
        await txn.rollback()
        return res
          .status(400)
          .json({ success: false, message: 'vehicle.model is required', data: {} })
      }
      if (
        !color ||
        typeof color !== 'object' ||
        Array.isArray(color) ||
        typeof color.name !== 'string' ||
        String(color.name).trim() === ''
      ) {
        await txn.rollback()
        return res
          .status(400)
          .json({ success: false, message: 'vehicle.color is required', data: {} })
      }
      const created = await vehicleRepo.findOrCreateByPlate(
        plate,
        { plate, brand, model, color, ...rest },
        txn
      )
      resolvedVehicleId = created.id as string
    }

    await driverVehicleRepo.link(driverId, resolvedVehicleId, txn)

    const driverRaw = await DriverRecord.findByPk(driverId, { transaction: txn })
    const currentSelected = (driverRaw?.get({ plain: true }) as any)?.selected_vehicle_id ?? null
    if (currentSelected === null) {
      await DriverRecord.update({ selected_vehicle_id: resolvedVehicleId } as any, {
        where: { id: driverId },
        transaction: txn,
      })
    }

    await txn.commit()
    return res.status(201).json({ success: true, data: { vehicle_id: resolvedVehicleId } })
  } catch (error) {
    await txn.rollback()
    if (error instanceof UniqueConstraintError) {
      return res.status(409).json({ error: 'link_already_exists' })
    }
    console.error('Error linking vehicle to driver:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

// PATCH /:id/vehicles/:vehicleId — update selectable flag for a driver-vehicle link
controller.patch('/:id/vehicles/:vehicleId', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const vehicleId = req.params.vehicleId
  const { selectable, confirmed } = req.body

  if (typeof selectable !== 'boolean') {
    return res
      .status(400)
      .json({ success: false, message: 'selectable must be a boolean', data: {} })
  }

  try {
    const driver = await Container.getDriverRecordRepository().findById(driverId)
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found', data: {} })
    }

    if (!selectable) {
      const assignment = await ActiveVehicleAssignmentRepository.findByDriver(driverId)
      if (assignment && assignment.vehicle_id === vehicleId) {
        if (confirmed !== true) {
          return res.status(409).json({
            error: 'vehicle_active',
            held_by: { id: driverId, name: (driver as any).name ?? '' },
          })
        }
        await forceDisconnect(driverId, 'vehicle_not_selectable')
      }
    }

    await driverVehicleRepo.setSelectable(driverId, vehicleId, selectable)

    if (!selectable) {
      const driverRaw = await DriverRecord.findByPk(driverId)
      const currentSelected = (driverRaw?.get({ plain: true }) as any)?.selected_vehicle_id ?? null
      if (currentSelected === vehicleId) {
        await autoPromoteSelectedVehicle(driverId)
      }
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Error updating vehicle selectable:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

// POST /:id/selected-vehicle — set the driver's selected vehicle
controller.post('/:id/selected-vehicle', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const { vehicleId } = req.body

  if (!vehicleId) {
    return res.status(400).json({ success: false, message: 'vehicleId is required', data: {} })
  }

  try {
    const driver = await Container.getDriverRecordRepository().findById(driverId)
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found', data: {} })
    }

    const eligibleLinks = await driverVehicleRepo.findEligibleForDriver(driverId)
    const isEligible = eligibleLinks.some((link) => link.vehicle_id === String(vehicleId))
    if (!isEligible) {
      return res.status(400).json({ error: 'vehicle_not_eligible' })
    }

    await DriverRecord.update({ selected_vehicle_id: String(vehicleId) } as any, {
      where: { id: driverId },
    })

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Error setting selected vehicle:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.post('/:id/recharges', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const { amount, created_by, note } = req.body

  if (typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({
      success: false,
      message: 'amount must be a non-zero number',
      data: {},
    })
  }

  if (
    !created_by ||
    typeof created_by.uid !== 'string' ||
    !created_by.uid ||
    typeof created_by.name !== 'string' ||
    !created_by.name
  ) {
    return res.status(400).json({
      success: false,
      message: 'created_by.uid and created_by.name are required',
      data: {},
    })
  }

  try {
    const { recharge, driver } = await Container.getRechargeRepository().create({
      driverId,
      amount,
      createdBy: { uid: created_by.uid, name: created_by.name },
      note: note ?? null,
    })
    await store.refreshDrivers()
    return res.status(201).json({ success: true, data: { recharge, driver } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    if (message === 'Driver not found') {
      return res.status(404).json({ success: false, message, data: {} })
    }
    console.error('Error creating recharge:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.get('/:id/recharges', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const page = parseInt(String(req.query.page ?? '1'), 10) || 1
  const perPage = parseInt(String(req.query.perPage ?? '20'), 10) || 20

  try {
    const { rows, total } = await Container.getRechargeRepository().listForDriver(driverId, {
      page,
      perPage,
    })
    return res.status(200).json({ success: true, data: { recharges: rows, total } })
  } catch (error) {
    console.error('Error fetching recharges:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.post('/:id/monthly-payments', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const { amount, created_by, note, period: periodInput } = req.body

  if (typeof amount !== 'number' || Number.isNaN(amount) || amount < 0) {
    return res.status(400).json({
      success: false,
      message: 'amount must be a number >= 0',
      data: {},
    })
  }

  if (
    !created_by ||
    typeof created_by.uid !== 'string' ||
    !created_by.uid ||
    typeof created_by.name !== 'string' ||
    !created_by.name
  ) {
    return res.status(400).json({
      success: false,
      message: 'created_by.uid and created_by.name are required',
      data: {},
    })
  }

  let period: string
  if (periodInput === undefined || periodInput === null || periodInput === '') {
    period = currentPeriod()
  } else {
    if (typeof periodInput !== 'string' || !PERIOD_FORMAT.test(periodInput)) {
      return res.status(400).json({
        success: false,
        message: 'period must match the format YYYY-MM',
        data: {},
      })
    }
    period = periodInput
  }

  try {
    const { payment, driver } = await Container.getMonthlyPaymentRepository().create({
      driverId,
      period,
      amount,
      createdBy: { uid: created_by.uid, name: created_by.name },
      note: note ?? null,
    })
    await store.refreshDrivers()
    return res.status(201).json({ success: true, data: { payment, driver } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    if (message === 'Driver not found') {
      return res.status(404).json({ success: false, message, data: {} })
    }
    console.error('Error creating monthly payment:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.get('/:id/monthly-payments', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const page = parseInt(String(req.query.page ?? '1'), 10) || 1
  const perPage = parseInt(String(req.query.perPage ?? '20'), 10) || 20

  try {
    const { rows, total } = await Container.getMonthlyPaymentRepository().listForDriver(driverId, {
      page,
      perPage,
    })
    return res.status(200).json({ success: true, data: { rows, total } })
  } catch (error) {
    console.error('Error fetching monthly payments:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.post('/:id/monthly-payments/:paymentId/void', async (req: Request, res: Response) => {
  const driverId = req.params.id
  const paymentId = req.params.paymentId
  const { reason, created_by } = req.body

  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({
      success: false,
      message: 'reason is required',
      data: {},
    })
  }

  if (
    !created_by ||
    typeof created_by.uid !== 'string' ||
    !created_by.uid ||
    typeof created_by.name !== 'string' ||
    !created_by.name
  ) {
    return res.status(400).json({
      success: false,
      message: 'created_by.uid and created_by.name are required',
      data: {},
    })
  }

  try {
    const payment = await Container.getMonthlyPaymentRepository().void(driverId, paymentId, {
      uid: created_by.uid,
      name: created_by.name,
      reason,
    })
    await store.refreshDrivers()
    return res.status(200).json({ success: true, data: { payment } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    if (message === 'Payment not found') {
      return res.status(404).json({ success: false, message, data: {} })
    }
    if (message === 'Payment already voided') {
      return res.status(409).json({ success: false, message, data: {} })
    }
    console.error('Error voiding monthly payment:', error)
    return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
  }
})

controller.get('/:id', async (req: Request, res: Response) => {
  try {
    const driverId = req.params.id
    const driver = await Container.getDriverRecordRepository().findById(driverId)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    // Build enriched response: omit legacy `vehicle` JSONB field, add roster and selected_vehicle
    const { vehicle: _vehicle, ...driverData } = driver as any

    const [roster, activeAssignment] = await Promise.all([
      driverVehicleRepo.listForDriver(driverId, { includeAll: true }),
      ActiveVehicleAssignmentRepository.findByDriver(driverId),
    ])

    let selected_vehicle = null
    const selectedVehicleId = (driverData as any).selected_vehicle_id ?? null
    if (selectedVehicleId) {
      selected_vehicle = await vehicleRepo.findById(selectedVehicleId)
    }

    const active_vehicle_id = activeAssignment?.vehicle_id ?? null

    return res.status(200).json({
      success: true,
      data: {
        driver: {
          ...driverData,
          selected_vehicle,
          roster,
          active_vehicle_id,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching driver:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/', async (req: Request, res: Response) => {
  try {
    const isLegacy = !req.body.driver
    if (isLegacy) {
      console.warn('[DEPRECATED] POST /drivers: legacy inline driver shape received')
    }

    const driverPayload: DriverInterface = isLegacy ? req.body : req.body.driver
    const vehiclePayload = isLegacy ? req.body.vehicle : req.body.vehicle

    const driver = await Container.getDriverRecordRepository().store(driverPayload)

    if (vehiclePayload) {
      let resolvedVehicleId: string | undefined
      if (vehiclePayload.vehicleId) {
        resolvedVehicleId = String(vehiclePayload.vehicleId)
      } else if (vehiclePayload.plate) {
        const vehicle = await vehicleRepo.findOrCreateByPlate(vehiclePayload.plate, vehiclePayload)
        resolvedVehicleId = vehicle.id as string
      }

      if (resolvedVehicleId) {
        await driverVehicleRepo.link(driver.id!, resolvedVehicleId)
        await DriverRecord.update({ selected_vehicle_id: resolvedVehicleId } as any, {
          where: { id: driver.id, selected_vehicle_id: null } as any,
        })
      }
    }

    await store.refreshDrivers()

    return res.status(201).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error creating driver:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.put('/:id', async (req: Request, res: Response) => {
  try {
    const isLegacy = !req.body.driver
    if (isLegacy) {
      console.warn('[DEPRECATED] PUT /drivers/:id: legacy inline driver shape received')
    }

    const rawPayload = isLegacy ? req.body : req.body.driver
    // Strip vehicle field — vehicle updates must go through /vehicles/:id and /drivers/:id/vehicles
    const { vehicle: _vehicle, ...driverFields } = rawPayload

    const driver = await Container.getDriverRecordRepository().store({
      ...(driverFields as DriverInterface),
      id: req.params.id,
    })
    await store.refreshDrivers()

    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const enabledAt = Number(req.body?.enabled_at ?? 0)

    if (enabledAt > 0) {
      const existing = await Container.getDriverRecordRepository().findById(req.params.id)
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found',
          data: {},
        })
      }
      if (existing.paymentMode === 'monthly') {
        const hasPaid = await Container.getMonthlyPaymentRepository().hasPaymentForPeriod(
          req.params.id,
          currentPeriod()
        )
        if (!hasPaid) {
          return res.status(422).json({
            success: false,
            message: 'El conductor no tiene pago registrado para el mes en curso.',
            data: {},
          })
        }
      }
    }

    const driver = await Container.getDriverRecordRepository().setEnabled(req.params.id, enabledAt)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver enabled state:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/email', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updateEmail(
      req.params.id,
      String(req.body?.email ?? '')
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver email:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/password', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updatePassword(
      req.params.id,
      String(req.body?.password ?? '')
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver password:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/balance', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updateBalance(
      req.params.id,
      Number(req.body?.balance ?? 0)
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver balance:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/device', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updateDevice(
      req.params.id,
      req.body?.device ?? null
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver device:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

const PAYMENT_MODES = ['monthly', 'percentage']

controller.patch('/:id/payment-mode', async (req: Request, res: Response) => {
  try {
    const paymentMode = String(req.body?.paymentMode ?? '')
    if (!PAYMENT_MODES.includes(paymentMode)) {
      return res.status(400).json({
        success: false,
        message: `Invalid paymentMode value. Allowed values: ${PAYMENT_MODES.join(', ')}`,
        data: {},
      })
    }

    const driver = await Container.getDriverRecordRepository().updatePaymentMode(
      req.params.id,
      paymentMode
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver payment mode:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

publicController.get('/:id', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().findById(req.params.id)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    const selectedVehicleId = driver.selected_vehicle_id ?? null
    const [rosterLinks, activeAssignment] = await Promise.all([
      driverVehicleRepo.listForDriver(req.params.id, { includeAll: true }),
      ActiveVehicleAssignmentRepository.findByDriver(req.params.id),
    ])

    const activeVehicleId = activeAssignment?.vehicle_id ?? null
    const roster = rosterLinks.map((link) =>
      toMobileDriverVehicle(link.vehicle, {
        selectedVehicleId,
        isSelectable: link.selectable,
        activeVehicleId,
      })
    )

    let selected_vehicle = roster.find((vehicle) => vehicle.id === selectedVehicleId) ?? null
    if (selectedVehicleId && selected_vehicle === null) {
      const vehicle = await vehicleRepo.findById(selectedVehicleId)
      if (vehicle) {
        selected_vehicle = toMobileDriverVehicle(vehicle, {
          selectedVehicleId,
          isSelectable: false,
          activeVehicleId,
        })
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        driver: {
          ...driver,
          selected_vehicle_id: selectedVehicleId,
          selected_vehicle,
          roster,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching public driver:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

publicController.patch('/:id/device', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updateDevice(
      req.params.id,
      req.body?.device ?? null
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver device:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

publicController.patch('/:id/last-connection', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updateLastConnection(
      req.params.id,
      Number(req.body?.last_connection ?? dayjs().unix())
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating driver last connection:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

publicController.patch('/:id/balance', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().updateBalance(
      req.params.id,
      Number(req.body?.balance ?? 0)
    )
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating public driver balance:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

publicController.patch('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const enabledAt = Number(req.body?.enabled_at ?? 0)

    if (enabledAt > 0) {
      const existing = await Container.getDriverRecordRepository().findById(req.params.id)
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found',
          data: {},
        })
      }
      if (existing.paymentMode === 'monthly') {
        const hasPaid = await Container.getMonthlyPaymentRepository().hasPaymentForPeriod(
          req.params.id,
          currentPeriod()
        )
        if (!hasPaid) {
          return res.status(422).json({
            success: false,
            message: 'El conductor no tiene pago registrado para el mes en curso.',
            data: {},
          })
        }
      }
    }

    const driver = await Container.getDriverRecordRepository().setEnabled(req.params.id, enabledAt)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    await store.refreshDrivers()
    return res.status(200).json({
      success: true,
      data: { driver },
    })
  } catch (error) {
    console.error('Error updating public driver enabled state:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export { publicController as PublicDriversController }
export default controller
