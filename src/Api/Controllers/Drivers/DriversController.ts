import { Request, Response, Router } from 'express'
import dayjs from 'dayjs'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { DriverInterface } from '../../../Interfaces/DriverInterface'
import { Store } from '../../../Services/store/Store'

const controller = Router()
const publicController = Router()
const store = Store.getInstance()

controller.use(requireAuth)

controller.get('/', async (_req: Request, res: Response) => {
  try {
    const drivers = await Container.getDriverRecordRepository().index()
    return res.status(200).json({
      success: true,
      data: { drivers },
    })
  } catch (error) {
    console.error('Error fetching drivers:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
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
