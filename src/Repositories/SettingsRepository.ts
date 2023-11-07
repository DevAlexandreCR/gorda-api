import Database from '../Services/firebase/Database'
import {ClientDictionary} from "../Interfaces/ClientDiccionary";
import {WpClient} from "../Interfaces/WpClient";

class SettingsRepository {
	
	/* istanbul ignore next */
	enableWpNotifications(clientId: string, enable: boolean): Promise<void> {
		return Database.dbWpClients().child(clientId).child('wpNotifications').set(enable);
	}

	/* istanbul ignore next */
	async getWpClients(): Promise<ClientDictionary> {
		const clients: ClientDictionary = {}
		await Database.dbWpClients().get().then(snapshot => {
			snapshot.forEach(data => {
				if (data.key) clients[data.key] = <WpClient>data.val()
			})
		})
		return clients
	}
}
export default new SettingsRepository()