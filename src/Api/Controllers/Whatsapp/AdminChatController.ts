import { Request, Response, Router } from 'express'
import { requireAuth } from '../../../Middlewares/Authorization'
import ChatRepository from '../../../Repositories/ChatRepository'
import MessageRepository from '../../../Repositories/MessageRepository'
import SessionRepository from '../../../Repositories/SessionRepository'
import { SessionStatuses } from '../../../Types/SessionStatuses'

const controller = Router()

controller.use(requireAuth)

controller.get('/clients/:wpClientId/chats', async (req: Request, res: Response) => {
  try {
    const chats = await ChatRepository.listChats(req.params.wpClientId)

    return res.status(200).json({
      success: true,
      data: { chats },
    })
  } catch (error) {
    console.error('Error fetching whatsapp chats:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get(
  '/clients/:wpClientId/chats/:chatId/messages',
  async (req: Request, res: Response) => {
    try {
      const messages = await MessageRepository.listMessages(
        req.params.wpClientId,
        req.params.chatId
      )

      return res.status(200).json({
        success: true,
        data: { messages },
      })
    } catch (error) {
      console.error('Error fetching whatsapp messages:', error)
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        data: {},
      })
    }
  }
)

controller.patch('/clients/:wpClientId/chats/:chatId', async (req: Request, res: Response) => {
  try {
    const archived = req.body?.archived

    if (typeof archived !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'archived must be a boolean',
        data: {},
      })
    }

    const chat = await ChatRepository.updateChat(req.params.wpClientId, req.params.chatId, {
      archived,
    })

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { chat },
    })
  } catch (error) {
    console.error('Error updating whatsapp chat:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.patch('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const status = req.body?.status as SessionStatuses | undefined

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'status is required',
        data: {},
      })
    }

    if (status !== SessionStatuses.SUPPORT) {
      return res.status(400).json({
        success: false,
        message: 'Only SUPPORT status updates are currently supported',
        data: {},
      })
    }

    const session = await SessionRepository.claimSupport(req.params.sessionId)

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { session },
    })
  } catch (error) {
    console.error('Error updating whatsapp session:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
