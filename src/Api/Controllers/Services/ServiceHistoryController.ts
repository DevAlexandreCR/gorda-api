import { Request, Response, Router } from 'express'
import * as Sentry from '@sentry/node'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import ChatIdHelper from '../../../Helpers/ChatIdHelper'

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
    const routeIntegrity: 'flagged' | undefined =
      req.query.routeIntegrity === 'flagged' ? 'flagged' : undefined

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
        routeIntegrity,
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

controller.get('/route-integrity', async (req: Request, res: Response) => {
  try {
    const from = Number(req.query.from)
    const to = Number(req.query.to)

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return res.status(400).json({
        success: false,
        message: 'from and to are required numeric unix timestamps',
        data: {},
      })
    }

    const driverId = typeof req.query.driverId === 'string' ? req.query.driverId : undefined

    const repository = Container.getServiceHistoryRepository()
    const rows = await repository.aggregateRouteIntegrity({ from, to, driverId })

    return res.status(200).json({
      success: true,
      data: { rows },
    })
  } catch (error) {
    console.error('Error fetching route integrity report:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/clients/:clientId/completed-count', async (req: Request, res: Response) => {
  try {
    ChatIdHelper.toCanonicalClientId(req.params.clientId)
    let completedServicesCount = await Container.getServiceHistoryRepository().count({
      clientId: req.params.clientId,
      status: 'terminated',
    })
    if (completedServicesCount < 0) {
      Sentry.captureException(
        new Error(
          `Unexpected negative count for clientId=${req.params.clientId}: ${completedServicesCount}`
        )
      )
      completedServicesCount = 0
    }
    return res.status(200).json({
      success: true,
      data: { completedServicesCount },
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('toCanonicalClientId:')) {
      return res.status(400).json({
        success: false,
        message: error.message,
        data: {},
      })
    }
    Sentry.captureException(error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
