import { Request, Response, Router } from 'express'
import Container from '../../../Container/Container'
import { validateRequest } from '../../../Middlewares/ValidateRequest'
import { requireAuth } from '../../../Middlewares/Authorization'
import { IndexClientsRequest, StoreClientRequest } from '../../Requests/Clients'

const controller = Router()

controller.use(requireAuth)

controller.get(
  '/',
  validateRequest(IndexClientsRequest),
  async (req: Request, res: Response) => {
    try {
      const { search } = req.query as { search?: string }
      const clientRepository = Container.getClientRepository()
      const clients = await clientRepository.index(search)

      return res.status(200).json({
        success: true,
        data: { clients },
      })
    } catch (error) {
      console.error('Error fetching clients:', error)
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        data: {},
      })
    }
  }
)

controller.post(
  '/',
  validateRequest(StoreClientRequest),
  async (req: Request, res: Response) => {
    try {
      const { id, name, phone, photoUrl } = req.body as {
        id?: string
        name: string
        phone: string
        photoUrl?: string
      }

      const clientRepository = Container.getClientRepository()
      const client = await clientRepository.store({
        id,
        name: name.trim(),
        phone,
        photoUrl,
      })

      return res.status(201).json({
        success: true,
        data: { client },
      })
    } catch (error: any) {
      const message =
        error instanceof Error ? error.message : 'Failed to create client'

      if (message.includes('Client')) {
        return res.status(400).json({
          success: false,
          message,
          data: {},
        })
      }

      console.error('Error creating client:', error)
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        data: {},
      })
    }
  }
)

export default controller
