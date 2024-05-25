import { WpMessageInterface } from "./WpMessageInterface";

export interface WpChatInterface {
    sendMessage(message: string): Promise<WpMessageInterface>
    archive(): Promise<void>
}