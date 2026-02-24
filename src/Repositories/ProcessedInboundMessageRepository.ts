import { Op } from 'sequelize'
import ProcessedInboundMessage from '../Models/ProcessedInboundMessage'

class ProcessedInboundMessageRepository {
  public async exists(wpClientId: string, messageId: string): Promise<boolean> {
    const row = await ProcessedInboundMessage.findOne({
      attributes: ['id'],
      where: { wpClientId, messageId },
    })
    return row !== null
  }

  public async record(wpClientId: string, messageId: string, provider: string): Promise<void> {
    await ProcessedInboundMessage.upsert({
      wpClientId,
      messageId,
      provider,
      processedAt: new Date(),
    }).catch((error) => console.log('[ProcessedInboundMessageRepository] record error', error.message))
  }

  public async purgeOlderThanMinutes(minutes: number): Promise<number> {
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 1440
    const cutoffDate = new Date(Date.now() - safeMinutes * 60 * 1000)

    return ProcessedInboundMessage.destroy({
      where: {
        processedAt: {
          [Op.lt]: cutoffDate,
        },
      },
    })
  }
}

export default new ProcessedInboundMessageRepository()
