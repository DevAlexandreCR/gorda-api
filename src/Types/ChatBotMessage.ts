import { Interactive } from "../Services/whatsapp/services/Official/Constants/Interactive"

export type ChatBotMessage = {
  id: string
  name: string
  description: string
  message: string
  enabled: boolean
  intereactive: Interactive | null
}