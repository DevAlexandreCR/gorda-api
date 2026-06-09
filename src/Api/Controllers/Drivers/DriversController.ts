import { Request, Response, Router } from 'express'
import dayjs from 'dayjs'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { DriverInterface } from '../../../Interfaces/DriverInterface'
import { Store } from '../../../Services/store/Store'
import { DriverListQuery } from '../../../Repositories/DriverRecordRepository'
import DriverRepository from '../../../Repositories/DriverRepository'
import FCM from '../../../Services/firebase/FCM'
import { FCMNotification } from '../../../Types/FCMNotifications'

const controller = Router()
const publicController = Router()
const store = Store.getInstance()

controller.use(requireAuth)

const LISTED_PARAMS = ['search', 'status', 'paymentMode', 'inactiveDays', 'sort', 'page', 'perPage']
const ALLOWED_PER_PAGE = [20, 30, 50]

controller.get('/', async (req: Request, res: Response) => {
  const hasListedParams = LISTED_PARAMS.some((p) => req.query[p] !== undefined)

  if (!hasListedParams) {
    try {
      const drivers = await Container.getDriverRecordRepository().index()
      return res.status(200).json({ drivers, total: drivers.length })
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
    const { search, status, paymentMode, inactiveDays, sort, page, perPage } = req.query

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

    const query: DriverListQuery = {
      search: search !== undefined ? String(search) : undefined,
      status: status !== undefined ? String(status) : undefined,
      paymentMode: paymentMode !== undefined ? String(paymentMode) : undefined,
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

controller.get('/:id', async (req: Request, res: Response) => {
  try {
    const driver = await Container.getDriverRecordRepository().findById(req.params.id)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { driver },
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
    const driver = await Container.getDriverRecordRepository().store(req.body as DriverInterface)
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
    const driver = await Container.getDriverRecordRepository().store({
      ...(req.body as DriverInterface),
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
    const driver = await Container.getDriverRecordRepository().setEnabled(
      req.params.id,
      Number(req.body?.enabled_at ?? 0)
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

    return res.status(200).json({
      success: true,
      data: { driver },
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
    const driver = await Container.getDriverRecordRepository().setEnabled(
      req.params.id,
      Number(req.body?.enabled_at ?? 0)
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
