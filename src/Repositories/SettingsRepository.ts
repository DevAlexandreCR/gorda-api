import Database from '../Services/firebase/Database'

class SettingsRepository {
	
	/* istanbul ignore next */
	enableWpNotifications(enable: boolean): Promise<void> {
		return Database.dbSettings().child('wpNotifications').set(enable);
	}
}
export default new SettingsRepository()