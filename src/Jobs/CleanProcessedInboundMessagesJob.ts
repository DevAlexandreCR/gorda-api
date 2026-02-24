import config from '../../config'
import ProcessedInboundMessageRepository from '../Repositories/ProcessedInboundMessageRepository'

export async function cleanProcessedInboundMessages(): Promise<void> {
  const maxAgeMinutes = Number(config.INBOUND_MESSAGE_MAX_AGE_MINUTES) || 1440
  const dedupTtlMinutes = (Number(config.INBOUND_MESSAGE_DEDUP_TTL_SECONDS) || 259200) / 60
  const retentionMinutes = Math.max(maxAgeMinutes, dedupTtlMinutes) + 60

  await ProcessedInboundMessageRepository.purgeOlderThanMinutes(retentionMinutes)
    .then((deletedRows) => {
      console.log(
        `[CleanProcessedInboundMessagesJob] Deleted ${deletedRows} rows older than ${retentionMinutes} minutes`
      )
    })
    .catch((error) => {
      console.log('[CleanProcessedInboundMessagesJob] Error', error.message)
    })
}
