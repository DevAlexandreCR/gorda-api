import { Request, Response, Router } from 'express'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { Store } from '../../../Services/store/Store'
import { RideFeeInterface } from '../../../Types/RideFeeInterface'
import { WpClient } from '../../../Interfaces/WpClient'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'

const controller = Router()
const store = Store.getInstance()

controller.use(requireAuth)

controller.get('/wp-clients', async (_req: Request, res: Response) => {
  try {
    const clients = await Container.getMasterDataRepository().listWpClients()

    return res.status(200).json({
      success: true,
      data: { clients },
    })
  } catch (error) {
    console.error('Error fetching wp clients:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.post('/wp-clients', async (req: Request, res: Response) => {
  try {
    const payload = req.body as WpClient
    const client = await Container.getMasterDataRepository().storeWpClient(payload)
    await store.refreshWpClients()

    return res.status(201).json({
      success: true,
      data: { client },
    })
  } catch (error) {
    console.error('Error creating wp client:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/wp-clients/:id', async (req: Request, res: Response) => {
  try {
    const client = await Container.getMasterDataRepository().updateWpClient(req.params.id, req.body)
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
        data: {},
      })
    }

    await store.refreshWpClients()
    return res.status(200).json({
      success: true,
      data: { client },
    })
  } catch (error) {
    console.error('Error updating wp client:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.delete('/wp-clients/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await Container.getMasterDataRepository().deleteWpClient(req.params.id)
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
        data: {},
      })
    }

    await store.refreshWpClients()
    return res.status(200).json({
      success: true,
      data: {},
    })
  } catch (error) {
    console.error('Error deleting wp client:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/ride-fees', async (_req: Request, res: Response) => {
  try {
    const rideFees = await Container.getMasterDataRepository().buildPricingSnapshot()

    return res.status(200).json({
      success: true,
      data: { rideFees },
    })
  } catch (error) {
    console.error('Error fetching ride fees:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.put('/ride-fees', async (req: Request, res: Response) => {
  try {
    const rideFees = await Container.getMasterDataRepository().updateRideFees(
      req.body as RideFeeInterface
    )

    return res.status(200).json({
      success: true,
      data: { rideFees },
    })
  } catch (error) {
    console.error('Error updating ride fees:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/chatbot-messages', async (_req: Request, res: Response) => {
  try {
    const messages = await Container.getMasterDataRepository().listChatBotMessages()

    return res.status(200).json({
      success: true,
      data: { messages },
    })
  } catch (error) {
    console.error('Error fetching chatbot messages:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.put('/chatbot-messages/:id', async (req: Request, res: Response) => {
  try {
    const message = await Container.getMasterDataRepository().updateChatBotMessage(
      req.params.id,
      req.body as ChatBotMessage
    )
    await store.refreshMessages()

    return res.status(200).json({
      success: true,
      data: { message },
    })
  } catch (error) {
    console.error('Error updating chatbot message:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/branches', async (_req: Request, res: Response) => {
  try {
    const branches = await Container.getMasterDataRepository().getBranches()

    return res.status(200).json({
      success: true,
      data: { branches },
    })
  } catch (error) {
    console.error('Error fetching branches:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/branches/:branchId/cities/:cityId', async (req: Request, res: Response) => {
  try {
    const percentage = Number(req.body?.percentage)
    const city = await Container.getMasterDataRepository().updateCityPercentage(
      req.params.branchId,
      req.params.cityId,
      percentage
    )

    if (!city) {
      return res.status(404).json({
        success: false,
        message: 'City not found',
        data: {},
      })
    }

    await store.getBranches()
    return res.status(200).json({
      success: true,
      data: { city },
    })
  } catch (error) {
    console.error('Error updating city settings:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
