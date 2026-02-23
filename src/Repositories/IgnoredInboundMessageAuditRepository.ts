import { Op } from 'sequelize'
import IgnoredInboundMessageAudit from '../Models/IgnoredInboundMessageAudit'
import {
  IgnoredInboundMessageAuditInterface,
  IgnoredInboundMessageReason,
} from '../Interfaces/IgnoredInboundMessageAuditInterface'

type IgnoredInboundEventInput = {
  wpClientId: string
  provider: string
  messageId: string
  chatId?: string | null
  rawTimestamp?: string | number | null
  messageType?: string | null
  reason: IgnoredInboundMessageReason
  messageAgeMinutes?: number | null
  messageTimestamp?: number | null
}

class IgnoredInboundMessageAuditRepository {
  public async recordIgnoredEvent(payload: IgnoredInboundEventInput): Promise<void> {
    const value: IgnoredInboundMessageAuditInterface = {
      wpClientId: payload.wpClientId,
      provider: payload.provider,
      messageId: payload.messageId,
      chatId: payload.chatId ?? null,
      rawTimestamp:
        payload.rawTimestamp === null || payload.rawTimestamp === undefined
          ? null
          : String(payload.rawTimestamp),
      messageType: payload.messageType ?? null,
      reason: payload.reason,
      messageAgeMinutes:
        payload.messageAgeMinutes === null || payload.messageAgeMinutes === undefined
          ? null
          : Number(payload.messageAgeMinutes.toFixed(2)),
      messageTimestamp:
        payload.messageTimestamp === null || payload.messageTimestamp === undefined
          ? null
          : Math.floor(payload.messageTimestamp),
      receivedAt: new Date(),
    }

    await IgnoredInboundMessageAudit.upsert(value).catch((error) => console.log(error.message))
  }

  public async purgeOlderThanDays(days: number): Promise<number> {
    const retentionDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 14
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

    return IgnoredInboundMessageAudit.destroy({
      where: {
        receivedAt: {
          [Op.lt]: cutoffDate,
        },
      },
    })
  }
}

export default new IgnoredInboundMessageAuditRepository()
