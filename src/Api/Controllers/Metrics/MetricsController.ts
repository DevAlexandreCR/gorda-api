import { Request, Response, Router } from 'express'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'

dayjs.extend(utc)
dayjs.extend(timezone)

const controller = Router()

controller.use(requireAuth)

controller.get('/global', async (req: Request, res: Response) => {
  try {
    const startDate = String(req.query.startDate ?? '').trim()
    const endDate = String(req.query.endDate ?? '').trim()

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
        data: {},
      })
    }

    const metrics = await Container.getServiceMetricsDailyRepository().listGlobal(
      startDate,
      endDate
    )

    return res.status(200).json({
      success: true,
      data: metrics,
    })
  } catch (error) {
    console.error('Error fetching global metrics:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/top-drivers', async (req: Request, res: Response) => {
  try {
    const frequency = String(req.query.frequency ?? 'daily')
    const from = Number(req.query.from)
    const to = Number(req.query.to)

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return res.status(400).json({
        success: false,
        message: 'from and to are required numeric unix timestamps',
        data: {},
      })
    }

    if (frequency !== 'daily' && frequency !== 'weekly') {
      return res.status(400).json({
        success: false,
        message: 'frequency must be daily or weekly',
        data: {},
      })
    }

    const drivers = await Container.getServiceHistoryRepository().listTopDrivers({
      from,
      to,
    })

    return res.status(200).json({
      success: true,
      data: { drivers },
    })
  } catch (error) {
    console.error('Error fetching top-driver metrics:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
