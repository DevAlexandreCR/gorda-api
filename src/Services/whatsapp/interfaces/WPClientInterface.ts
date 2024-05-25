import { WpEvents } from '../constants/WpEvents'
import { WpStates } from '../constants/WpStates'
import { WpChatInterface } from './WpChatInterface'

export interface WPClientInterface {

    info: string

    build(): this
    sendMessage(phoneNumber: string, message: string): boolean
    receiveMessage(phoneNumber: string): string
    on(event: WpEvents, callback: Function): void
    getWWebVerison(): Promise<string>
    getState(): Promise<WpStates>
    getChatById(chatId: string): Promise<WpChatInterface>
    logout(): Promise<void>
    getWWebVersion(): Promise<string>
    initialize(): Promise<void>
}
