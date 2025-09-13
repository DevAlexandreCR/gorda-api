import { MessageHandlerInterface } from '../Interfaces/MessageHandlerInterface'
import { AIResponseInterface } from '../Interfaces/AIResponseInterface'
import { Message } from '../../../../Interfaces/Message'
import { MessageTypes } from '../../../../Services/whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import DateHelper from '../../../../Helpers/DateHelper'
import axios, { AxiosResponse } from 'axios'
import config from '../../../../../config'
import { AIResponse } from '../Interfaces/AIResponse'

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

  async handleMessage(message: string, sessionStatus: SessionStatuses): Promise<AIResponseInterface> {
    const data = await this.requestAIService(message, sessionStatus)

    console.log('AI service response data:', data.data) // Debug log

    const messageText = data.data.outputText
    const sessionStatusR = data.data.sessionStatus

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
      name: data.data.name,
      message: responseMessage,
      sessionStatus: sessionStatusR,
      place: data.data.place
    }

    return Promise.resolve(response)
  }

  private requestAIService(message: string, sessionStatus: SessionStatuses): Promise<AxiosResponse<AIResponse>> {
    return axios.post(
      this.apiURL + '/chat/messages',
      {
        content: message,
        session_status: sessionStatus
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