import { MessageHandlerInterface } from '../Interfaces/MessageHandlerInterface'
import { AIResponseInterface } from '../Interfaces/AIResponseInterface'
import { Message } from '../../../../Interfaces/Message'
import { MessageTypes } from '../../../../Services/whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import DateHelper from '../../../../Helpers/DateHelper'
import axios, { AxiosResponse } from 'axios'
import config from '../../../../../config'

export class GordaChatBot implements MessageHandlerInterface {
  private apiURL: string
  private apiKey: string

  constructor() {
    this.apiURL = config.AI_SERVICE_URL
    this.apiKey = config.AI_SERVICE_API_KEY
    if (!this.apiURL || !this.apiKey) {
      throw new Error('AI service URL or API key is not defined in environment variables.')
    }
  }

  async handleMessage(message: string): Promise<AIResponseInterface> {
    const data = await this.requestAIService(message)

    console.log('AI service response data:', data.data) // Debug log

    const parsedData = JSON.parse(data.data)
    const messageText = parsedData.message
    const sessionStatus = parsedData.session_status as SessionStatuses

    let responseMessage: Message = {
      id: DateHelper.unix().toString(),
      created_at: DateHelper.unix(),
      type: MessageTypes.TEXT,
      body: messageText,
      fromMe: true,
      interactive: null,
      interactiveReply: null
    }

    const response: AIResponseInterface = {
      name: parsedData.name || null,
      message: responseMessage,
      session_status: sessionStatus
    }

    return Promise.resolve(response)
  }

  private requestAIService(message: string): Promise<AxiosResponse> {
    return axios.post(
      this.apiURL + '/chat/messages',
      {
        content: message,
        session_status: SessionStatuses.CREATED
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        }
      }
    )
  }
}