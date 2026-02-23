import config from '../../config'
import IgnoredInboundMessageAuditRepository from '../Repositories/IgnoredInboundMessageAuditRepository'

export async function cleanIgnoredInboundAudit(): Promise<void> {
  const retentionDays = Number(config.IGNORED_INBOUND_AUDIT_RETENTION_DAYS) || 14

  await IgnoredInboundMessageAuditRepository.purgeOlderThanDays(retentionDays)
    .then((deletedRows) => {
      console.log(
        `[CleanIgnoredInboundAuditJob] Deleted ${deletedRows} rows older than ${retentionDays} days`
      )
    })
    .catch((error) => {
      console.log('[CleanIgnoredInboundAuditJob] Error', error.message)
    })
}
