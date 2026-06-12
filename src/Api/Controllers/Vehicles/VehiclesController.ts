import { Request, Response, Router } from 'express'
import { requireAuth } from '../../../Middlewares/Authorization'
import VehicleRepository, { VehicleSearchQuery } from '../../../Repositories/VehicleRepository'
import ActiveVehicleAssignmentRepository from '../../../Repositories/ActiveVehicleAssignmentRepository'
import { normalizePlate } from '../../../Helpers/PlateHelper'
import sequelize from '../../../Database/sequelize'
import { QueryTypes } from 'sequelize'
import { forceDisconnect } from '../../../Services/drivers/ForceDisconnect'
import { autoPromoteSelectedVehicle } from '../../../Services/drivers/AutoPromoteVehicle'

const controller = Router()
const vehicleRepo = new VehicleRepository()

controller.use(requireAuth)

const ALLOWED_PER_PAGE = [20, 30, 50]

// GET /vehicles
controller.get('/', async (req: Request, res: Response) => {
  try {
    const { search, enabled, sort, page, perPage } = req.query

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

    const pageNum = Math.max(1, parseInt(String(page ?? '1'), 10) || 1)

    let enabledFilter: boolean | undefined = undefined
    if (enabled !== undefined) {
      enabledFilter = enabled === 'true' || enabled === '1'
    }

    const query: VehicleSearchQuery = {
      search: search !== undefined ? String(search) : undefined,
      enabled: enabledFilter,
      sort: sort !== undefined ? String(sort) : undefined,
      page: pageNum,
      perPage: perPage !== undefined ? Number(perPage) : undefined,
    }

    const { vehicles, total } = await vehicleRepo.search(query)
    return res.status(200).json({
      success: true,
      data: { vehicles, total },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    if (message.startsWith('Invalid sort field')) {
      return res.status(400).json({ success: false, message, data: {} })
    }
    console.error('Error fetching vehicles:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

// GET /vehicles/lookup?plate= — must be registered BEFORE GET /vehicles/:id
controller.get('/lookup', async (req: Request, res: Response) => {
  try {
    const { plate } = req.query
    if (!plate || typeof plate !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'plate query parameter is required',
        data: {},
      })
    }

    const normalized = normalizePlate(plate)
    const vehicle = await vehicleRepo.findByNormalizedPlate(normalized)
    if (!vehicle) {
      return res.status(404).json({ error: 'vehicle_not_found' })
    }

    const vehicleWithDrivers = await vehicleRepo.findWithLinkedDrivers(vehicle.id)

    const assignment = await ActiveVehicleAssignmentRepository.findByVehicle(vehicle.id)
    let currently_driven_by: { id: string; name: string } | null = null
    if (assignment) {
      const rows = await sequelize.query<{ id: string; name: string }>(
        `SELECT id, name FROM drivers WHERE id = :driverId LIMIT 1`,
        { replacements: { driverId: assignment.driver_id }, type: QueryTypes.SELECT }
      )
      if (rows.length > 0) {
        currently_driven_by = { id: rows[0].id, name: rows[0].name }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        vehicle: vehicleWithDrivers ?? vehicle,
        linked_drivers: vehicleWithDrivers?.linked_drivers ?? [],
        currently_driven_by,
      },
    })
  } catch (error) {
    console.error('Error looking up vehicle:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

// GET /vehicles/:id
controller.get('/:id', async (req: Request, res: Response) => {
  try {
    const vehicleWithDrivers = await vehicleRepo.findWithLinkedDrivers(req.params.id)
    if (!vehicleWithDrivers) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { vehicle: vehicleWithDrivers, linked_drivers: vehicleWithDrivers.linked_drivers },
    })
  } catch (error) {
    console.error('Error fetching vehicle:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

// POST /vehicles
controller.post('/', async (req: Request, res: Response) => {
  try {
    const { plate, brand, model, color, photo_url, soat_exp, tec_exp } = req.body

    if (!plate || typeof plate !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'plate is required',
        data: {},
      })
    }

    if (!brand || typeof brand !== 'string' || brand.trim() === '') {
      return res.status(400).json({ success: false, message: 'brand is required', data: {} })
    }

    if (!model || typeof model !== 'string' || model.trim() === '') {
      return res.status(400).json({ success: false, message: 'model is required', data: {} })
    }

    if (!color || typeof color !== 'object' || Array.isArray(color) || typeof color.name !== 'string' || color.name.trim() === '') {
      return res.status(400).json({ error: 'color_invalid' })
    }

    const normalizedPlate = normalizePlate(plate)

    const existing = await vehicleRepo.findByNormalizedPlate(normalizedPlate)
    if (existing) {
      return res.status(409).json({
        error: 'plate_already_exists',
        vehicle_id: existing.id,
      })
    }

    const vehicle = await vehicleRepo.create({
      plate: normalizedPlate,
      brand: brand ?? null,
      model: model ?? null,
      color: color ?? null,
      photo_url: photo_url ?? null,
      soat_exp: soat_exp ?? null,
      tec_exp: tec_exp ?? null,
    })

    return res.status(201).json({
      success: true,
      data: { vehicle },
    })
  } catch (error) {
    console.error('Error creating vehicle:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

// PATCH /vehicles/:id
controller.patch('/:id', async (req: Request, res: Response) => {
  if ('plate' in req.body) {
    return res.status(400).json({ error: 'plate_immutable' })
  }

  try {
    const vehicle = await vehicleRepo.findById(req.params.id)
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
        data: {},
      })
    }

    const { color } = req.body
    if (color !== undefined && color !== null) {
      if (typeof color !== 'object' || Array.isArray(color) || typeof color.name !== 'string') {
        return res.status(400).json({ error: 'color_invalid' })
      }
    }

    await vehicleRepo.update(req.params.id, req.body)

    const updated = await vehicleRepo.findById(req.params.id)
    return res.status(200).json({
      success: true,
      data: { vehicle: updated },
    })
  } catch (error) {
    console.error('Error updating vehicle:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

// PATCH /vehicles/:id/enabled
controller.patch('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const { enabled, confirmed } = req.body
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean',
        data: {},
      })
    }

    const vehicle = await vehicleRepo.findById(req.params.id)
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
        data: {},
      })
    }

    if (!enabled) {
      const assignment = await ActiveVehicleAssignmentRepository.findByVehicle(req.params.id)
      if (assignment) {
        if (confirmed !== true) {
          const rows = await sequelize.query<{ id: string; name: string }>(
            `SELECT id, name FROM drivers WHERE id = :driverId LIMIT 1`,
            { replacements: { driverId: assignment.driver_id }, type: QueryTypes.SELECT }
          )
          const held_by =
            rows.length > 0
              ? { id: rows[0].id, name: rows[0].name }
              : { id: assignment.driver_id, name: '' }
          return res.status(409).json({ error: 'vehicle_active', held_by })
        }
        await forceDisconnect(assignment.driver_id, 'vehicle_disabled')
      }
    }

    await vehicleRepo.setEnabled(req.params.id, enabled)

    if (!enabled) {
      const affectedDrivers = await sequelize.query<{ id: string }>(
        `SELECT id FROM drivers WHERE selected_vehicle_id = :vehicleId`,
        { replacements: { vehicleId: req.params.id }, type: QueryTypes.SELECT }
      )
      await Promise.all(affectedDrivers.map((d) => autoPromoteSelectedVehicle(d.id)))
    }

    const updated = await vehicleRepo.findById(req.params.id)
    return res.status(200).json({
      success: true,
      data: { vehicle: updated },
    })
  } catch (error) {
    console.error('Error updating vehicle enabled state:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
