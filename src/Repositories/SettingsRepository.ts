import Database from '../Services/firebase/Database'
import {ClientDictionary} from "../Interfaces/ClientDiccionary";
import {WpClient} from "../Interfaces/WpClient";

class SettingsRepository {
	
	/* istanbul ignore next */
	enableWpNotifications(clientId: string, enable: boolean): Promise<void> {
		return Database.dbWpClients().child(clientId).child('wpNotifications').set(enable);
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
}
export default new SettingsRepository()