import { Request, Response, Router } from 'express'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { UserInterface } from '../../../Interfaces/UserInterface'

const controller = Router()

controller.use(requireAuth)

controller.get('/', async (_req: Request, res: Response) => {
  try {
    const users = await Container.getUserRecordRepository().index()
    return res.status(200).json({
      success: true,
      data: { users },
    })
  } catch (error) {
    console.error('Error fetching users:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await Container.getUserRecordRepository().findById(req.params.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { user },
    })
  } catch (error) {
    console.error('Error fetching user:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/', async (req: Request, res: Response) => {
  try {
    const user = await Container.getUserRecordRepository().store(req.body as UserInterface)
    return res.status(201).json({
      success: true,
      data: { user },
    })
  } catch (error) {
    console.error('Error creating user:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.put('/:id', async (req: Request, res: Response) => {
  try {
    const user = await Container.getUserRecordRepository().store({
      ...(req.body as UserInterface),
      id: req.params.id,
    })

    return res.status(200).json({
      success: true,
      data: { user },
    })
  } catch (error) {
    console.error('Error updating user:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/enabled', async (req: Request, res: Response) => {
  try {
    const user = await Container.getUserRecordRepository().setEnabled(
      req.params.id,
      Number(req.body?.enabled_at ?? 0)
    )
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { user },
    })
  } catch (error) {
    console.error('Error updating user enabled state:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/:id/password', async (req: Request, res: Response) => {
  try {
    const user = await Container.getUserRecordRepository().updatePassword(
      req.params.id,
      String(req.body?.password ?? '')
    )
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { user },
    })
  } catch (error) {
    console.error('Error updating user password:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
