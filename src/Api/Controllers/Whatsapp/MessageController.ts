import { OfficialClient } from '../../../Services/whatsapp/services/Official/OfficialClient'
import { WpMessageAdapter } from '../../../Services/whatsapp/services/Official/Adapters/WpMessageAdapter'
import { Request, Response, Router } from 'express'
import { WpEvents } from '../../../Services/whatsapp/constants/WpEvents'
import { Store } from '../../../Services/store/Store'
import MessageRepository from '../../../Repositories/MessageRepository'
import IgnoredInboundMessageAuditRepository from '../../../Repositories/IgnoredInboundMessageAuditRepository'
import config from '../../../../config'
import { MessageTypes } from '../../../Services/whatsapp/constants/MessageTypes'
import { MessagesEnum } from '../../../Services/chatBot/MessagesEnum'
import MessageHelper from '../../../Helpers/MessageHelper'
import InboundMessageMetrics from '../../../Services/whatsapp/monitoring/InboundMessageMetrics'
import { InboundMessagePolicy } from '../../../Services/whatsapp/policies/InboundMessagePolicy'
import InboundMessageDedupCache from '../../../Services/whatsapp/policies/InboundMessageDedupCache'
import { WpClients } from '../../../Services/whatsapp/constants/WPClients'

const controller = Router()
const store = Store.getInstance()

type WebhookMessage = {
  id: string
  timestamp?: number | string
  from: string
  type?: string
  text?: { body?: string }
  location?: { name?: string; latitude: number; longitude: number }
  interactive?: any
}

controller.post('/whatsapp/webhook', (req: Request, res: Response) => {
  res.status(200).json({ messages: ['ok'] })

  void processWebhookPayload(req.body).catch((error: any) => {
    console.log('[WhatsAppWebhook] Failed to process payload', error?.message ?? error)
  })
})

async function processWebhookPayload(body: any): Promise<void> {
  const entries = Array.isArray(body?.entry) ? body.entry : []

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      if (change?.field !== 'messages') {
        continue
      }

      const value = change.value
      if (value?.errors) {
        console.log('[WhatsAppWebhook] Message error', JSON.stringify(value.errors))
        continue
      }

      const messages = Array.isArray(value?.messages) ? value.messages : []
      if (messages.length === 0) {
        continue
      }

      const profileName = value.contacts ? value.contacts[0]?.profile?.name : undefined
      const wpClient = store.wpClients[value?.metadata?.phone_number_id] ?? null
      if (!wpClient) {
        console.log('[WhatsAppWebhook] wpClient not found')
        continue
      }

      const wpClientService = OfficialClient.getInstance(wpClient)
      for (const message of messages) {
        try {
          await processOfficialMessage(message, profileName, wpClient.id, wpClientService)
        } catch (error: any) {
          console.log('[WhatsAppWebhook] Error processing message', {
            messageId: message?.id,
            wpClientId: wpClient.id,
            error: error?.message ?? error,
          })
        }
      }
    }
  }
}

async function processOfficialMessage(
  message: WebhookMessage,
  profileName: string | undefined,
  wpClientId: string,
  wpClientService: OfficialClient
): Promise<void> {
  if (message.text && message.text.body === 'PING') {
    return
  }

  if (message.type === 'system') {
    return
  }

  if (message.text && !message.text.body?.trim()) {
    return
  }

  const provider = WpClients.OFFICIAL
  const messageId = resolveMessageId(message.id)
  const policyDecision = InboundMessagePolicy.evaluate(message.timestamp)
  const maxAgeMinutes = Number(config.INBOUND_MESSAGE_MAX_AGE_MINUTES) || 120

  if (
    policyDecision.reason === 'invalid_timestamp_processed' ||
    policyDecision.reason === 'future_timestamp_processed'
  ) {
    InboundMessageMetrics.increment({
      provider,
      wpClientId,
      reason: policyDecision.reason,
    })
    console.log(
      '[InboundMessageTimestampAnomaly]',
      JSON.stringify({
        provider,
        wpClientId,
        messageId,
        from: message.from,
        reason: policyDecision.reason,
        rawTimestamp: message.timestamp ?? null,
        normalizedTimestamp: policyDecision.normalizedTimestamp,
        ageMinutes: policyDecision.ageMinutes,
        maxAgeMinutes,
        at: new Date().toISOString(),
      })
    )
  }

  if (policyDecision.action === 'ignore') {
    InboundMessageMetrics.increment({
      provider,
      wpClientId,
      reason: 'old_message',
    })
    await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
      wpClientId,
      provider,
      messageId,
      chatId: message.from,
      rawTimestamp: message.timestamp ?? null,
      messageType: message.type ?? null,
      reason: 'old_message',
      messageAgeMinutes: policyDecision.ageMinutes,
      messageTimestamp: policyDecision.normalizedTimestamp,
    })
    console.log(
      '[InboundMessageIgnored]',
      JSON.stringify({
        provider,
        wpClientId,
        messageId,
        from: message.from,
        reason: 'old_message',
        rawTimestamp: message.timestamp ?? null,
        normalizedTimestamp: policyDecision.normalizedTimestamp,
        ageMinutes: policyDecision.ageMinutes,
        maxAgeMinutes,
        at: new Date().toISOString(),
      })
    )
    return
  }

  const dedupDecision = await InboundMessageDedupCache.evaluate(wpClientId, messageId)
  if (dedupDecision.action === 'ignore') {
    InboundMessageMetrics.increment({
      provider,
      wpClientId,
      reason: 'duplicate_message',
    })
    await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
      wpClientId,
      provider,
      messageId,
      chatId: message.from,
      rawTimestamp: message.timestamp ?? null,
      messageType: message.type ?? null,
      reason: 'duplicate_message',
      messageAgeMinutes: policyDecision.ageMinutes,
      messageTimestamp: policyDecision.normalizedTimestamp,
    })
    console.log(
      '[InboundMessageIgnored]',
      JSON.stringify({
        provider,
        wpClientId,
        messageId,
        from: message.from,
        reason: 'duplicate_message',
        rawTimestamp: message.timestamp ?? null,
        normalizedTimestamp: policyDecision.normalizedTimestamp,
        ageMinutes: policyDecision.ageMinutes,
        maxAgeMinutes,
        at: new Date().toISOString(),
      })
    )
    return
  }

  await InboundMessageDedupCache.recordProcessed(wpClientId, messageId, provider)

  const messageTimestamp = policyDecision.normalizedTimestamp ?? Math.floor(Date.now() / 1000)

  const type: MessageTypes = message.text?.body
    ? MessageTypes.TEXT
    : message.location
      ? MessageTypes.LOCATION
      : message.type
        ? (message.type as MessageTypes)
        : MessageTypes.UNKNOWN
  const wpMessage = new WpMessageAdapter(
    {
      id: messageId,
      timestamp: messageTimestamp,
      from: message.from + '@c.us',
      type: type,
      isStatus: false,
      body: message.text?.body ?? type,
      location: message.location
        ? {
          name: message.location?.name ?? MessageHelper.LOCATION_NO_NAME,
          lat: message.location?.latitude,
          lng: message.location?.longitude,
        }
        : undefined,
      interactiveReply: message.interactive ?? null,
    },
    wpClientService
  )

  if (wpMessage.interactiveReply) {
    wpMessage.body = wpMessage.interactiveReply.button_reply?.id ?? wpMessage.body
  }

  const chat = await store.getChatById(wpClientId, message.from, profileName)

  await MessageRepository.addMessage(wpClientId, chat.id, {
    id: wpMessage.id,
    created_at: messageTimestamp,
    type: type,
    body: wpMessage.body,
    location: wpMessage.location ?? null,
    fromMe: false,
    interactiveReply: wpMessage.interactiveReply,
    interactive: null,
  })

  wpClientService.triggerEvent(WpEvents.MESSAGE_RECEIVED, wpMessage)

  const hasTextContent = message.text?.body?.trim()
  const isProcessableType =
    type === MessageTypes.TEXT || type === MessageTypes.LOCATION || type === MessageTypes.INTERACTIVE

  if (!hasTextContent && !isProcessableType) {
    const msg = store.findMessageById(MessagesEnum.MESSAGE_TYPE_NOT_SUPPORTED)
    wpClientService.sendMessage(wpMessage.from, msg)
  }
}

function resolveMessageId(messageId?: string): string {
  if (messageId && messageId.trim()) return messageId.trim()
  return `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

controller.get('/whatsapp/webhook', async (req: Request, res: Response) => {
  console.log('webhook get', req.query)

  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode && token) {
    if (mode === 'subscribe' && token === config.FIREBASE_PROJECT_ID) {
      console.log('WEBHOOK_VERIFIED')
      res.status(200).send(challenge)
    } else {
      res.sendStatus(403)
    }
  } else {
    res.sendStatus(422)
  }
})

export default controller
