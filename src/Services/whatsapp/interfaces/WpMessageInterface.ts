import { MessageTypes } from '../constants/MessageTypes'
import { WpChatInterface } from './WpChatInterface'

export interface WpMessageInterface {
    id: { id: string}
    message: string
    timestamp: number
    status: string
    fromMe: boolean
    chatId: string
    type: MessageTypes
    from: string
    isStatus: boolean
    body: string
    location: {
        name: string
        latitude: string
        longitude: string
    }

    getChat(): Promise<WpChatInterface>
}