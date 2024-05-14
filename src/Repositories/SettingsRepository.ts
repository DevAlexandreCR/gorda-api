import Database from '../Services/firebase/Database'
import {ClientDictionary} from '../Interfaces/ClientDiccionary'
import {WpClient} from '../Interfaces/WpClient'
import {ChatBotMessage} from '../Types/ChatBotMessage'
import Firestore from '../Services/firebase/Firestore'
import {MessagesEnum} from '../Services/chatBot/MessagesEnum'

class SettingsRepository {
	
	/* istanbul ignore next */
	async enableWpNotifications(clientId: string, enable: boolean): Promise<void> {
		await Database.dbWpClients().child(clientId).child('wpNotifications').set(enable)
	}

	/* istanbul ignore next */
	getWpClients(listener: (clients: ClientDictionary) => void): void {
		Database.dbWpClients().on('value', (snapshot) => {
			const clients: ClientDictionary = {}
			snapshot.forEach(data => {
				if (data.key)
					clients[data.key] = <WpClient>data.val()
			})
			listener(clients)
		})
	}

	/* istanbul ignore next */
	getChatBotMessages(listener: (messages: Map<MessagesEnum, ChatBotMessage>) => void): void {
		Firestore.dbChatBotMessages().onSnapshot((snapshot) => {
			const msgs = new Map<MessagesEnum, ChatBotMessage>()
			snapshot.forEach(doc => {
				const data = doc.data()
				const chatBotMessage: ChatBotMessage = {
					id: data.id,
					name: data.name,
					description: data.description,
					message: data.message,
					enabled: data.enabled
				}
				const messageEnumValue: MessagesEnum | undefined = Object.values(MessagesEnum).find(value => value === doc.id);
				if (messageEnumValue) {
					msgs.set(messageEnumValue, chatBotMessage);
				} else {
					console.warn(`Unknown enum value: ${doc.id}`);
				}
			})
			listener(msgs)
		})
	}
}
export default new SettingsRepository()