import {ClientSession} from "whatsapp-web.js"
import * as fs from "fs"
import WhatsAppClient from "./WhatsAppClient";

export function onAuth(session: ClientSession) {
  fs.writeFile(WhatsAppClient.SESSION_PATH, JSON.stringify(session), (err) => {
    if (err) {
      console.error(err);
    }
  })
}

export enum EmitEvents {
	FAILURE = 'failure',
	NAVIGATION = 'NAVIGATION',
	
	GET_STATE = 'get-state'
}