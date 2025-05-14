import { ChatBotMessage } from "../../Types/ChatBotMessage"
import config from "../../../config"

export enum Placeholders {
  PLATE = 'PLATE',
  COLOR = 'COLOR',
  USERNAME = 'USERNAME',
  PQR_NUMBER = 'PQR-NUMBER',
  PLACE = 'PLACE',
  COMPANY = 'COMPANY',
}

const placeholdersMap: Map<Placeholders, string> = new Map<Placeholders, string>()
placeholdersMap.set(Placeholders.PLATE, '')
placeholdersMap.set(Placeholders.COLOR, '')
placeholdersMap.set(Placeholders.USERNAME, '')
placeholdersMap.set(Placeholders.PQR_NUMBER, config.PQR_NUMBER)
placeholdersMap.set(Placeholders.PLACE, '')
placeholdersMap.set(Placeholders.COMPANY, config.APP_NAME)

export const getPlaceholders = (): Map<Placeholders, string> => {
  return placeholdersMap
}
export const getPlaceholder = (placeholder: Placeholders): string => {
  const value = placeholdersMap.get(placeholder)
  if (!value) {
    console.warn(`Placeholder ${placeholder} not found`)
    return ''
  }
  return value
}

export function replacePlaceholders(input: ChatBotMessage, placeholders: Map<Placeholders, string>): ChatBotMessage {
  let result = input.message
  placeholders.forEach((value, key) => {
    const regex = new RegExp('\\[\\[' + key + '\\]\\]', 'g')
    result = result.replace(regex, value)
  })

  input.message = result

  if (input.interactive) {
    let interactive = input.interactive.body?.text
    placeholders.forEach((value, key) => {
      const regex = new RegExp('\\[\\[' + key + '\\]\\]', 'g')
      interactive = result.replace(regex, value)
    })
    if (input.interactive.body && interactive !== undefined) {
      input.interactive.body.text = interactive
    }
  }

  return input
}