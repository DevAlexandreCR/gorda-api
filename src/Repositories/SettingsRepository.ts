import Database from '../Services/firebase/Database'
import {ClientDictionary} from "../Interfaces/ClientDiccionary";
import {WpClient} from "../Interfaces/WpClient";
import {ChatBotMessage} from '../Types/ChatBotMessage'
import Firestore from '../Services/firebase/Firestore'

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
	getChatBotMessages(listener: (messages: Map<string, ChatBotMessage>) => void): void {
		Firestore.dbChatBotMessages().onSnapshot((snapshot) => {
			const msgs = new Map<string, ChatBotMessage>()
			snapshot.forEach(doc => {
				const data = doc.data()
				const chatBotMessage: ChatBotMessage = {
					id: data.id,
					name: data.name,
					description: data.description,
					message: data.message,
					enabled: data.enabled
				}
				msgs.set(doc.id, chatBotMessage)
			})
			listener(msgs)
		})
	}
}
export default new SettingsRepository()