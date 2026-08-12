import { SessionInterface } from '../Interfaces/SessionInterface'
import SessionRepository from '../Repositories/SessionRepository'
import { PlaceOption } from '../Interfaces/PlaceOption'
import Place from './Place'
import { WpMessage } from '../Types/WpMessage'
import { ResponseContext } from '../Services/chatBot/MessageStrategy/ResponseContext'
import MessageHelper from '../Helpers/MessageHelper'
import { WpLocation } from '../Types/WpLocation'
import { exit } from 'process'
import config from '../../config.js'
import { WpNotifications } from '../Types/WpNotifications'
import { NotificationType } from '../Types/NotificationType'
import { getSingleMessage } from '../Services/chatBot/Messages'
import { MessagesEnum } from '../Services/chatBot/MessagesEnum'
import { WpChatInterface } from '../Services/whatsapp/interfaces/WpChatInterface'
import { WpMessageInterface } from '../Services/whatsapp/interfaces/WpMessageInterface'
import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'
import { ChatBotMessage } from '../Types/ChatBotMessage'
import { SessionStatuses } from '../Types/SessionStatuses'
import { PlaceInterface } from '../Interfaces/PlaceInterface'
import { DiscardedTurnError } from '../Services/chatBot/turns/DiscardedTurnError'
import { enqueueConversationTurn } from '../Services/chatBot/turns/ConversationTurnQueue'
import { isDebounceableMsg } from '../Services/whatsapp/policies/DebounceableMessagePolicy'

// Session.processMessage swallows every error internally (fallback message on
// genuine failures, silent skip on DiscardedTurnError) and never rejects, so a
// caller outside Session — the conversation-turn processor (task 3.6) — has no
// way to learn what actually happened other than this return value. It mirrors
// (and is a subset of, minus 'superseded_pre_ai' which only the processor's own
// pre-AI gate can determine) the processor's outcome vocabulary (design D9).
export type SessionProcessOutcome = 'completed' | 'discarded_post_ai' | 'error'

// Returned by addMsg so callers (and the enqueue decision inside addMsg itself)
// know whether SessionRepository.addMsg's findOrCreate actually stored a new
// message. `id` is the wamid (SessionRepository.addMsg returns messageRecord.messageId,
// not the auto-increment PK), matching what getNewestUnprocessedMessageId compares
// against (design D2/D8).
export type AddMsgResult = { id: string; created: boolean }

export default class Session implements SessionInterface {
  public id: string
  public status: SessionStatuses
  public chat_id: string
  public placeOptions?: Array<PlaceOption>
  public assigned_at: number = 0
  public service_id: string | null
  public created_at: number
  public updated_at: number | null
  public place: PlaceInterface | null = null
  public messages: Map<string, WpMessage> = new Map()
  public chat: WpChatInterface
  public wp_client_id: string
  public notifications: WpNotifications
  private turnMessageId: string | null = null
  private turnDepth = 0

  static readonly STATUS_AGREEMENT = SessionStatuses.AGREEMENT
  static readonly STATUS_CREATED = SessionStatuses.CREATED
  static readonly STATUS_ASKING_FOR_PLACE = SessionStatuses.ASKING_FOR_PLACE
  static readonly STATUS_CHOOSING_PLACE = SessionStatuses.CHOOSING_PLACE
  static readonly STATUS_ASKING_FOR_COMMENT = SessionStatuses.ASKING_FOR_COMMENT
  static readonly STATUS_REQUESTING_SERVICE = SessionStatuses.REQUESTING_SERVICE
  static readonly STATUS_SERVICE_IN_PROGRESS = SessionStatuses.SERVICE_IN_PROGRESS
  static readonly STATUS_COMPLETED = SessionStatuses.COMPLETED
  static readonly STATUS_ASKING_FOR_NAME = SessionStatuses.ASKING_FOR_NAME
  static readonly STATUS_SUPPORT = SessionStatuses.SUPPORT

  constructor(chat_id: string) {
    this.chat_id = chat_id
    this.created_at = new Date().getTime()
    this.status = Session.STATUS_CREATED
    this.service_id = null
    this.notifications = {
      greeting: false,
      assigned: false,
      arrived: false,
      completed: false,
    }
  }

  isCompleted(): boolean {
    return this.status === Session.STATUS_COMPLETED
  }

  async setAssigned(assigned: boolean = true): Promise<void> {
    this.assigned_at = assigned ? new Date().getTime() : 0
    await SessionRepository.updateId(this)
  }

  async addMsg(msg: WpMessageInterface): Promise<AddMsgResult> {
    const wpMessage: WpMessage = {
      created_at: msg.timestamp,
      id: msg.id,
      type: msg.type,
      msg: msg.body,
      location: null,
      processed: false,
      interactiveReply: msg.interactiveReply,
      interactive: null,
      fromMe: false,
    }

    if (msg.location) {
      const loc = msg.location as unknown as WpLocation
      wpMessage.location = {
        name: loc.name ?? MessageHelper.LOCATION_NO_NAME,
        lat: parseFloat(msg.location.lat.toString()),
        lng: parseFloat(msg.location.lng.toString()),
      }
      wpMessage.msg = ''
    } else if (msg.type === MessageTypes.INTERACTIVE) {
      wpMessage.msg = msg.interactiveReply?.button_reply?.id ?? ''
    }

    return SessionRepository.addMsg(this.id, wpMessage)
      .then((result) => {
        if (!result.created) {
          // Deduplicated by SessionRepository.addMsg's findOrCreate: enqueue nothing.
          return result
        }

        this.messages.set(result.id, wpMessage)

        // Enqueue a conversation-turn job instead of scheduling in-memory processing
        // (design D1/D5/D8). This replaces both the old LOCATION fast path (immediate
        // processMessage call) and the branch that used to kick off processUnprocessedMessages'
        // timer — both removed in task 4.2. Delay is 0 for LOCATION/INTERACTIVE
        // (design D5) and CHATBOT_DEBOUNCE_MS for TEXT.
        const delayMs = isDebounceableMsg(msg) ? (config.CHATBOT_DEBOUNCE_MS as number) : 0
        enqueueConversationTurn(
          {
            wpClientId: this.wp_client_id,
            sessionId: this.id,
            chatId: this.chat_id,
            messageId: result.id,
          },
          delayMs
        )

        return result
      })
      .catch((e) => {
        console.log(e.message)
        return { id: msg.id, created: false }
      })
  }

  // Boot-time replacement for the old processUnprocessedMessages timer sweep
  // (design D8): ChatBot.syncSessions calls this once per active session
  // instead of the removed syncMessages(true) path. Enqueues a delay-0 turn
  // job for the session's newest unprocessed message so a restart doesn't
  // silently drop messages whose delayed job was lost mid-flight (spec:
  // chatbot-turn-debounce, "Process restart during debounce window"). A
  // redundant enqueue — the original delayed job also survived the restart —
  // is harmless: the processor's pre-AI gate treats the second job as
  // superseded_pre_ai, keeping "at most one reply" true.
  async enqueueBootSweepTurn(): Promise<void> {
    try {
      const messageId = await SessionRepository.getNewestUnprocessedMessageId(this.id)
      if (!messageId) {
        return
      }

      enqueueConversationTurn(
        {
          wpClientId: this.wp_client_id,
          sessionId: this.id,
          chatId: this.chat_id,
          messageId,
        },
        0
      )
    } catch (e) {
      // One bad session must not abort ChatBot's boot sweep over the rest.
      console.warn('boot sweep: failed to enqueue turn for session', this.id, e)
    }
  }

  // Merges every currently unprocessed message into one message: text bodies join
  // with a single space in arrival order, LOCATION type/payload is adopted from any
  // buffered message that carries one, and all other base fields (including
  // interactiveReply/interactive) come from the newest buffered message.
  buildMergedUnprocessedMessage(): WpMessage {
    const unprocessedMessagesArray = Array.from(this.getUnprocessedMessages().values())
    const text = unprocessedMessagesArray.map((msg) => msg.msg).join(' ')
    const indexLast = unprocessedMessagesArray.length - 1
    const wpMsg: WpMessage = {
      created_at: unprocessedMessagesArray[indexLast].created_at,
      id: unprocessedMessagesArray[indexLast].id,
      type: unprocessedMessagesArray[indexLast].type,
      location: null,
      msg: text,
      processed: false,
      interactiveReply: unprocessedMessagesArray[indexLast].interactiveReply,
      interactive: null,
      fromMe: false,
    }

    unprocessedMessagesArray.forEach((msg) => {
      if (msg.location) {
        wpMsg.location = msg.location
        wpMsg.type = MessageTypes.LOCATION
      }
    })

    return wpMsg
  }

  async syncMessages(): Promise<void> {
    this.messages = await SessionRepository.getMessages(this.id)
  }

  // Public accessor for turn processors outside Session (task 3.6): the same
  // messages buildMergedUnprocessedMessage draws from, as an array in arrival
  // order — mirrors what processUnprocessedMessages' now-removed timer branch
  // used to build inline (design D8).
  getUnprocessedMessagesArray(): WpMessage[] {
    return Array.from(this.getUnprocessedMessages().values())
  }

  private getUnprocessedMessages(): Map<string, WpMessage> {
    const unprocessedMessages = new Map<string, WpMessage>()

    this.messages.forEach((message) => {
      if (!message.processed) {
        unprocessedMessages.set(message.id, message)
      }
    })

    return unprocessedMessages
  }

  async setService(serviceID: string): Promise<void> {
    this.service_id = serviceID
    await SessionRepository.updateService(this)
  }

  async setStatus(status: SessionStatuses): Promise<void> {
    this.status = status
    await SessionRepository.updateStatus(this)
  }

  async setPlace(place: PlaceInterface): Promise<void> {
    this.place = place
    await SessionRepository.updatePlace(this)
  }

  async setPlaceOptions(placeOptions: Array<PlaceOption>): Promise<void> {
    this.placeOptions = placeOptions
    await SessionRepository.updatePlaceOptions(this)
  }

  async setNotification(notification: NotificationType): Promise<void> {
    this.notifications[notification] = true
    await SessionRepository.updateNotification(this.id, this.notifications)
  }

  public setChat(chat: WpChatInterface): void {
    this.chat = chat
  }

  public setWpClientId(wpClientId: string): void {
    this.wp_client_id = wpClientId
  }

  public async sendMessage(content: ChatBotMessage): Promise<void> {
    await this.chat.sendMessage(content).then(() => {
      this.chat.archive().catch((e) => console.log(e.message))
    })
  }

  // Turn context (design D3). Counter-based so a nested call — e.g. AskingForPlace
  // calling `this.session.processMessage(...)` again while an outer turn is already
  // active — can never clobber or prematurely end the outer turn: only the
  // outermost beginTurn/endTurn pair sets/clears `turnMessageId`. Inner nested
  // calls just bump/decrement the depth counter and inherit the outer context.
  beginTurn(messageId: string): void {
    if (this.turnDepth === 0) {
      this.turnMessageId = messageId
    }
    this.turnDepth++
  }

  endTurn(): void {
    if (this.turnDepth === 0) {
      return
    }
    this.turnDepth--
    if (this.turnDepth === 0) {
      this.turnMessageId = null
    }
  }

  // Re-reads the newest-unprocessed wamid and the session's persisted status and
  // throws DiscardedTurnError when this turn is stale (design D3). Safe no-op when
  // no turn is active: the legacy setTimeout-based processing path (removed in
  // task 4.2) never called beginTurn, so the queue-driven flow through
  // ResponseContract (which calls this at its two gate points) is unaffected.
  async assertTurnStillValid(): Promise<void> {
    if (this.turnDepth === 0 || this.turnMessageId === null) {
      return
    }

    const activeMessageId = this.turnMessageId
    const [newestUnprocessedId, freshSession] = await Promise.all([
      SessionRepository.getNewestUnprocessedMessageId(this.id),
      SessionRepository.findSessionById(this.id),
    ])

    if (newestUnprocessedId !== null && newestUnprocessedId !== activeMessageId) {
      throw new DiscardedTurnError('superseded')
    }

    const status = freshSession?.status ?? this.status
    if (status === SessionStatuses.COMPLETED) {
      throw new DiscardedTurnError('completed')
    }
    if (status === SessionStatuses.SUPPORT) {
      throw new DiscardedTurnError('support')
    }
  }

  // Marks the batch processed. Moved out of a shared .finally() (design D3 point 4)
  // so a discarded turn (supersede/COMPLETED/SUPPORT) can skip it and leave its
  // messages unprocessed for the winning turn to re-merge (buildMergedUnprocessedMessage).
  // messageId/unprocessedMessages mirror the exact original .finally() body verbatim.
  private async markUnprocessedMessagesProcessed(
    messageId: string,
    unprocessedMessages: WpMessage[]
  ): Promise<void> {
    await SessionRepository.setProcessedMsgs(this.id, unprocessedMessages).then(() => {
      unprocessedMessages.forEach((msg) => {
        msg.processed = true
        this.messages.set(messageId, msg)
      })
    })
  }

  async processMessage(
    message: WpMessage,
    unprocessedMessages: WpMessage[]
  ): Promise<SessionProcessOutcome> {
    const handler = ResponseContext.getResponse(this.status, this)
    const response = new ResponseContext(handler)

    return response
      .processMessage(message)
      .then(async (): Promise<SessionProcessOutcome> => {
        await this.markUnprocessedMessagesProcessed(message.id, unprocessedMessages)
        return 'completed'
      })
      .catch(async (e): Promise<SessionProcessOutcome> => {
        if (e instanceof DiscardedTurnError) {
          // Benign discard (design D3): not an error, no fallback, messages stay
          // unprocessed so the winning turn's merge picks them up (design D3/D4).
          console.log('info: chatbot turn discarded post-AI', {
            wpClientId: this.wp_client_id,
            sessionId: this.id,
            messageId: message.id,
            outcome: 'discarded_post_ai',
            reason: e.reason,
          })
          return 'discarded_post_ai'
        }

        // Genuine failure: the customer gets the error fallback, so the batch is
        // still marked processed (today's behavior, preserved — design D3 only
        // carves out the discard case, not generic errors).
        await this.markUnprocessedMessagesProcessed(message.id, unprocessedMessages)

        console.log('error while processing message', {
          error: e.message,
          message: message.msg,
          stack: e.stack,
        })
        const msg = getSingleMessage(MessagesEnum.ERROR_WHILE_PROCESSING)
        if (msg.enabled) {
          await this.sendMessage(msg).catch((e) => {
            console.log('error while sending error message', e.message)
            exit(1)
          })
        }
        return 'error'
      })
  }
}
