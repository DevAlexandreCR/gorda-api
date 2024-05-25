import { WpEvents } from '../constants/WpEvents'
import { WpStates } from '../constants/WpStates'
import { WPClientInterface } from '../interfaces/WPClientInterface'
import { WpChatInterface } from '../interfaces/WpChatInterface'

export class OfficialClient implements WPClientInterface {
    info: string
    getWWebVersion(): Promise<string> {
        throw new Error('Method not implemented.')
    }
    initialize(): Promise<void> {
        throw new Error('Method not implemented.')
    }
    build(): this {
        throw new Error('Method not implemented.')
    }
    sendMessage(phoneNumber: string, message: string): boolean {
        throw new Error('Method not implemented.')
    }
    receiveMessage(phoneNumber: string): string {
        throw new Error('Method not implemented.')
    }
    on(event: WpEvents, callback: (...args: any) => void): void {
        throw new Error('Method not implemented.')
    }
    getWWebVerison(): Promise<string> {
        throw new Error('Method not implemented.')
    }
    getState(): Promise<WpStates> {
        throw new Error('Method not implemented.')
    }
    getChatById(chatId: string): Promise<WpChatInterface> {
        throw new Error('Method not implemented.')
    }
    logout(): Promise<void> {
        throw new Error('Method not implemented.')
    }
    static getConfig(): any {
        // Add your implementation here
    }
}
