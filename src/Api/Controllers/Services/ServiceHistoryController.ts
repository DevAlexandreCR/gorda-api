import { Request, Response, Router } from 'express'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'

const controller = Router()

controller.use(requireAuth)

controller.get('/history', async (req: Request, res: Response) => {
  try {
    const from = Number(req.query.from)
    const to = Number(req.query.to)
    const perPage = Math.min(Math.max(Number(req.query.perPage ?? 20), 1), 100)
    const direction = req.query.direction === 'prev' ? 'prev' : 'next'
    const cursorCreated = req.query.cursorCreated ? Number(req.query.cursorCreated) : undefined
    const cursorId =
      typeof req.query.cursorId === 'string' && req.query.cursorId.length > 0
        ? req.query.cursorId
        : undefined

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return res.status(400).json({
        success: false,
        message: 'from and to are required numeric unix timestamps',
        data: {},
      })
    }

    const repository = Container.getServiceHistoryRepository()
    const filters = {
      from,
      to,
      clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined,
      driverId: typeof req.query.driverId === 'string' ? req.query.driverId : undefined,
    }

    const [services, totalCount, terminatedCount, canceledCount] = await Promise.all([
      repository.listPage({
        ...filters,
        perPage,
        direction,
        cursorCreated,
        cursorId,
      }),
      repository.count(filters),
      repository.count({
        ...filters,
        status: 'terminated',
      }),
      repository.count({
        ...filters,
        status: 'canceled',
      }),
    ])

    return res.status(200).json({
      success: true,
      data: {
        services,
        totalCount,
        terminatedCount,
        canceledCount,
      },
    })
  } catch (error) {
    console.error('Error fetching service history:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
