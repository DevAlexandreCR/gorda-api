import { MessageHandlerInterface } from './Interfaces/MessageHandlerInterface'
import { AIResponseInterface } from './Interfaces/AIResponseInterface'
import { Message } from '../../../Interfaces/Message'
import { SessionStatuses } from '../../../Types/SessionStatuses'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import { Exception } from 'bullmq'

export class MessageHandler {
  constructor(private client: MessageHandlerInterface) { }

  async handleMessage(message: string): Promise<AIResponseInterface> {
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.client.handleMessage(message)
      } catch (error: unknown) {
        lastError = error as Error
        console.warn(`Attempt ${attempt} failed for message handling:`, (error as Error).message)

        // If this is not the last attempt, continue to retry
        if (attempt < maxRetries) {
          // Optional: Add a small delay between retries
          await new Promise(resolve => setTimeout(resolve, 1000))
          continue
        }
      }
    }

    console.error(`All ${maxRetries} attempts failed. Returning default response.`, lastError?.message)
    return this.getDefaultResponse()
  }

  private getDefaultResponse(): AIResponseInterface {
    const defaultMessage: Message = {
      id: `default_${Date.now()}`,
      created_at: Date.now(),
      type: MessageTypes.TEXT,
      body: 'Lo siento, estoy experimentando dificultades técnicas en este momento. En un momento uno de nuestros operadores se pondrá en contacto contigo.',
      fromMe: true,
      interactive: null,
      interactiveReply: null
    }

    return {
      name: 'Sistema',
      message: defaultMessage,
      session_status: SessionStatuses.SUPPORT
    }
  }
}
