import { Request, Response, Router } from 'express'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Container from '../../../Container/Container'
import { DriverAuthenticatedRequest, requireDriverAuth } from '../../../Middlewares/Authorization'

dayjs.extend(utc)
dayjs.extend(timezone)

const controller = Router()

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

export default controller
