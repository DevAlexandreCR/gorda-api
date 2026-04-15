import { Request, Response, Router } from 'express'
import ServiceHistoryMigrationService from '../../../Services/serviceHistory/ServiceHistoryMigrationService'
import { requireInternalAuth } from '../../../Middlewares/Authorization'

const controller = Router()
const service = new ServiceHistoryMigrationService()

controller.use(requireInternalAuth)

controller.post('/finalize', async (req: Request, res: Response) => {
  try {
    const serviceId = String(req.body?.serviceId ?? '').trim()

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: 'serviceId is required',
        data: {},
      })
    }

    const result = await service.finalizeServiceById(serviceId)

    return res.status(200).json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Error finalizing service history:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
