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
import {
  InboundMessagePolicy,
  InboundMessagePolicyDecision,
} from '../../../Services/whatsapp/policies/InboundMessagePolicy'
import InboundMessageDedupCache from '../../../Services/whatsapp/policies/InboundMessageDedupCache'
import { WpClients } from '../../../Services/whatsapp/constants/WPClients'
import { interactiveReplyId } from '../../../Services/whatsapp/interactive/interactiveReplyId'
import { promoteTextPick } from '../../../Services/whatsapp/interactive/promoteTextPick'
import {
  resolveOfficialSender,
  extractAttestedPhone,
  WebhookMessage,
  WebhookContact,
} from '../../../Services/whatsapp/services/Official/resolveOfficialSender'
import BsuidPendingStore from '../../../Services/whatsapp/services/Official/BsuidPendingStore'

const controller = Router()
const store = Store.getInstance()

// Hardcoded fallback for `request_contact_info`'s body text (design D3, finding 5):
// used only when the ASK_FOR_PHONE_NUMBER catalog row does not exist at all, so a
// missing seed never silently falls back to Store.findMessageById's fake DEFAULT_MESSAGE.
export const ASK_FOR_PHONE_NUMBER_FALLBACK =
  'Para continuar, necesitamos tu número de teléfono. Por favor, compártelo usando el botón que aparece a continuación.'

type ProcessOfficialMessageContext = {
  contacts?: WebhookContact[]
}

type InboundTypeClassification = 'processable' | 'media' | 'ignore'

const PROCESSABLE_INBOUND_TYPES: ReadonlySet<string> = new Set([
  MessageTypes.TEXT,
  MessageTypes.LOCATION,
  MessageTypes.INTERACTIVE,
])

const MEDIA_INBOUND_TYPES: ReadonlySet<string> = new Set([
  MessageTypes.AUDIO,
  MessageTypes.VOICE,
  MessageTypes.IMAGE,
  MessageTypes.VIDEO,
  MessageTypes.DOCUMENT,
])

export function classifyInboundType(type: string, hasText: boolean): InboundTypeClassification {
  if (hasText || PROCESSABLE_INBOUND_TYPES.has(type)) {
    return 'processable'
  }
  if (MEDIA_INBOUND_TYPES.has(type)) {
    return 'media'
  }
  return 'ignore'
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
      if (change?.field === 'user_id_update') {
        await handleUserIdUpdate(change.value)
        continue
      }

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
          console.log('[WhatsAppWebhook] Processing message', JSON.parse(JSON.stringify(message)))
          await processOfficialMessage(message, profileName, wpClient.id, wpClientService, {
            contacts: value.contacts,
          })
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

export async function processOfficialMessage(
  message: WebhookMessage,
  profileName: string | undefined,
  wpClientId: string,
  wpClientService: OfficialClient,
  context?: ProcessOfficialMessageContext
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
  // Crash fix (design D6/finding): audit/log calls assumed `from` was always present.
  // A BSUID-only message has no `from`, so every such call falls back to `from_user_id`.
  const senderKey = message.from ?? message.from_user_id ?? null
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
        from: senderKey,
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
      chatId: senderKey,
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
        from: senderKey,
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
      chatId: senderKey,
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
        from: senderKey,
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

  const normalizedTimestamp = policyDecision.normalizedTimestamp ?? Math.floor(Date.now() / 1000)

  // Link branch (design D4): an attested/forwarded contact-card reply is intercepted
  // here, before the resolver, and wins even if `message.from` also happens to be set.
  if (message.type === 'contacts') {
    await handleContactsLink(
      message,
      wpClientId,
      wpClientService,
      policyDecision,
      normalizedTimestamp
    )
    return
  }

  const resolved = resolveOfficialSender(message, context?.contacts, (userId) =>
    store.findClientByUserId(userId)
  )
  const effectiveProfileName = resolved.profileName ?? profileName

  if (resolved.source === 'none') {
    await handleUnknownSender(
      message,
      messageId,
      wpClientId,
      wpClientService,
      policyDecision,
      effectiveProfileName
    )
    return
  }

  const phone = resolved.phone as string

  // Opportunistic link/remember (design D1, case A): a resolvable phone always wins,
  // but when a BSUID also travels with it, link it onto the client now (or remember it
  // for when the client row is created) so case C can resolve it on a future message
  // with no `from` at all.
  if (resolved.userId) {
    const cachedClient = store.findClientById(phone)
    if (cachedClient) {
      if (cachedClient.wpUserId !== resolved.userId) {
        store.linkClientUserId(cachedClient.id, resolved.userId).catch((error: any) => {
          console.log(
            '[OfficialSenderLinkFailed]',
            JSON.stringify({
              wpClientId,
              phone,
              userId: resolved.userId,
              error: error?.message ?? error,
            })
          )
        })
      }
    } else {
      store.rememberUserIdForPhone(phone, resolved.userId)
    }
  }

  await dispatchResolvedMessage(
    message,
    phone,
    effectiveProfileName,
    wpClientId,
    wpClientService,
    normalizedTimestamp
  )
}

async function dispatchResolvedMessage(
  message: WebhookMessage,
  phone: string,
  profileName: string | undefined,
  wpClientId: string,
  wpClientService: OfficialClient,
  normalizedTimestamp: number
): Promise<void> {
  const messageId = resolveMessageId(message.id)
  const captionText = message.image?.caption ?? message.video?.caption ?? message.document?.caption
  const hasCaptionText = Boolean(captionText?.trim())
  const hasTextContent = Boolean(message.text?.body?.trim()) || hasCaptionText

  // A media message with a non-empty caption is classified as text (design D1) so it
  // reaches the chatbot like a normal text message instead of being filtered as media.
  const type: MessageTypes =
    message.text?.body || hasCaptionText
      ? MessageTypes.TEXT
      : message.location
        ? MessageTypes.LOCATION
        : message.type
          ? (message.type as MessageTypes)
          : MessageTypes.UNKNOWN
  const wpMessage = new WpMessageAdapter(
    {
      id: messageId,
      timestamp: normalizedTimestamp,
      from: phone + '@c.us',
      type: type,
      isStatus: false,
      body: message.text?.body ?? (hasCaptionText ? (captionText as string) : type),
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
    wpMessage.body = interactiveReplyId(wpMessage.interactiveReply) ?? wpMessage.body
  }

  const isChatBotEnabled = store.wpClients[wpClientId]?.chatBot === true

  // Spec: chatbot-candidate-list ("Plain-text picks are promoted on every transport").
  // Promote a plain-text pick of the latest offered list/button before the message is
  // persisted, so the stored row and the chatbot both see INTERACTIVE with the row id
  // as body, matching the Baileys behavior.
  if (isChatBotEnabled) {
    await promoteTextPick(wpClientId, phone, wpMessage)
  }

  const chat = await store.getChatById(wpClientId, phone, profileName)

  await MessageRepository.addMessage(wpClientId, chat.id, {
    id: wpMessage.id,
    created_at: normalizedTimestamp,
    type: wpMessage.type,
    body: wpMessage.body,
    location: wpMessage.location ?? null,
    fromMe: false,
    interactiveReply: wpMessage.interactiveReply,
    interactive: null,
  })

  wpClientService.triggerEvent(WpEvents.MESSAGE_RECEIVED, wpMessage)

  if (!isChatBotEnabled) {
    return
  }

  const classification = classifyInboundType(type, hasTextContent)

  if (classification === 'media') {
    const msg = store.findMessageById(MessagesEnum.MESSAGE_TYPE_NOT_SUPPORTED)
    if (msg.enabled) {
      wpClientService.sendMessage(wpMessage.from, msg)
    }
  } else if (classification === 'ignore') {
    console.log(
      JSON.stringify({
        event: 'inbound_ignored_type',
        type,
        wpClientId,
        messageId,
      })
    )
  }
}

// Design D3: the sender's phone could not be resolved by any precedence case. If the
// message would otherwise be processable, remember it (so it can be replayed once the
// phone is known) and, subject to a 10-minute rate limit per (wpClientId, BSUID) pair,
// ask for the phone via `request_contact_info`. Nothing is persisted to `whatsapp_messages`
// and no `MESSAGE_RECEIVED` event fires for this turn either way.
async function handleUnknownSender(
  message: WebhookMessage,
  messageId: string,
  wpClientId: string,
  wpClientService: OfficialClient,
  policyDecision: InboundMessagePolicyDecision,
  profileName: string | undefined
): Promise<void> {
  const provider = WpClients.OFFICIAL
  const userId = message.from_user_id

  if (!userId) {
    // Nothing to request against and nothing to key the pending entry on; this should
    // not happen per the resolver's contract, but logging beats throwing.
    console.log('[InboundPhoneRequestSkipped]', JSON.stringify({ wpClientId, messageId }))
    return
  }

  const key = `${wpClientId}:${userId}`
  BsuidPendingStore.rememberPending(key, message, profileName)

  let sent = false
  if (BsuidPendingStore.canRequest(key)) {
    // Finding 5: Store.findMessageById returns a fake, always-enabled DEFAULT_MESSAGE
    // for an unknown id, so the id must be checked before trusting `enabled`.
    const msg = store.findMessageById(MessagesEnum.ASK_FOR_PHONE_NUMBER)
    const bodyText =
      msg.id === MessagesEnum.ASK_FOR_PHONE_NUMBER
        ? msg.enabled
          ? msg.message
          : null
        : ASK_FOR_PHONE_NUMBER_FALLBACK

    if (bodyText) {
      try {
        await wpClientService.requestContactInfo(userId, bodyText)
        BsuidPendingStore.markRequested(key)
        sent = true
      } catch (error: any) {
        console.log(
          '[InboundPhoneRequestFailed]',
          JSON.stringify({ wpClientId, userId, error: error?.message ?? error })
        )
      }
    }
  }

  InboundMessageMetrics.increment({ provider, wpClientId, reason: 'phone_requested' })
  await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
    wpClientId,
    provider,
    messageId,
    chatId: userId,
    rawTimestamp: message.timestamp ?? null,
    messageType: message.type ?? null,
    reason: 'phone_requested',
    messageAgeMinutes: policyDecision.ageMinutes,
    messageTimestamp: policyDecision.normalizedTimestamp,
  })
  console.log(
    '[InboundPhoneRequested]',
    JSON.stringify({ wpClientId, userId, messageId, sent, at: new Date().toISOString() })
  )
}

// Design D4: a `contacts`-type reply to our own `request_contact_info` prompt. Only an
// `origin: 'contact_request'` entry is attested by WhatsApp; anything else (including no
// contact entries at all) is ignored — no link, no store write, no reply.
async function handleContactsLink(
  message: WebhookMessage,
  wpClientId: string,
  wpClientService: OfficialClient,
  policyDecision: InboundMessagePolicyDecision,
  normalizedTimestamp: number
): Promise<void> {
  const messageId = resolveMessageId(message.id)
  const phone = extractAttestedPhone(message)
  const userId = message.from_user_id

  if (!phone || !userId) {
    console.log(JSON.stringify({ event: 'inbound_contact_card_ignored', wpClientId, messageId }))
    return
  }

  const attestedCard = message.contacts?.find((card) => card.origin === 'contact_request')

  const client = await store.storeOrLinkClient({
    phone,
    name: attestedCard?.name?.formatted_name,
    userId,
  })

  await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
    wpClientId,
    provider: WpClients.OFFICIAL,
    messageId,
    chatId: phone,
    rawTimestamp: message.timestamp ?? null,
    messageType: message.type ?? null,
    reason: 'bsuid_linked',
    messageAgeMinutes: policyDecision.ageMinutes,
    messageTimestamp: policyDecision.normalizedTimestamp,
  })
  console.log(
    '[OfficialBsuidLinked]',
    JSON.stringify({ wpClientId, userId, phone, clientId: client.id })
  )

  const key = `${wpClientId}:${userId}`
  const pending = BsuidPendingStore.takePending(key)

  if (pending) {
    await dispatchResolvedMessage(
      pending.message,
      phone,
      pending.profileName,
      wpClientId,
      wpClientService,
      normalizedTimestamp
    )
    return
  }

  const greeting = store.findMessageById(MessagesEnum.GREETING)
  if (greeting.enabled) {
    wpClientService.sendMessage(phone + '@c.us', greeting)
  }
}

// Design D5: `user_id_update` relinks silently and never throws outward — there is no
// customer-facing action to take and no webhook-retry benefit from a 5xx here.
export async function handleUserIdUpdate(value: {
  user_id_update?: Array<{ user_id: { previous: string; current: string } }>
}): Promise<void> {
  const updates = Array.isArray(value?.user_id_update) ? value.user_id_update : []

  for (const update of updates) {
    const previous = update?.user_id?.previous
    const current = update?.user_id?.current

    if (!previous || !current) {
      continue
    }

    try {
      const relinked = await store.relinkClientUserId(previous, current)
      console.log(
        '[OfficialUserIdUpdate]',
        JSON.stringify({ previous, current, outcome: relinked ? 'linked' : 'no_prior_holder' })
      )
    } catch (error: any) {
      console.log(
        '[OfficialUserIdUpdate]',
        JSON.stringify({ previous, current, outcome: 'error', error: error?.message ?? error })
      )
    }
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
