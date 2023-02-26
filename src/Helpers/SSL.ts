import * as fs from 'fs'
import {ServerOptions} from 'https'

class SSL {
	getCredentials(domain: string): ServerOptions {
		if (!fs.existsSync(`/etc/letsencrypt/live/${domain}/privkey.pem`)) {
			return {
				key: '',
				cert: ''
			}
		}
		const privateKey = fs.readFileSync(`/etc/letsencrypt/live/${domain}/privkey.pem`, 'utf8')
		const certificate = fs.readFileSync(`/etc/letsencrypt/live/${domain}/cert.pem`, 'utf8')
		const ca = fs.readFileSync(`/etc/letsencrypt/live/${domain}/chain.pem`, 'utf8')
		
		return {
			key: privateKey,
			cert: certificate,
			ca: ca,
		}
	}
}

export default new SSL()
