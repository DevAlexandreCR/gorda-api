import { QueryTypes } from 'sequelize'
import dayjs from 'dayjs'
import 'dayjs/locale/es'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import sequelize from '../Database/sequelize'
import BillingLineChargeRecord from '../Models/BillingLineChargeRecord'
import BillingSettingRecord from '../Models/BillingSettingRecord'
import {
  BillingConfigResponse,
  BillingLineCharge,
  BillingSummaryResponse,
  BillingSummarySource,
  BillingWhatsappLineSummary,
} from '../Interfaces/BillingInterface'

const SOFTWARE_RENTAL_KEY = 'software_rental'
const BILLING_TIMEZONE = 'America/Bogota'

dayjs.extend(utc)
dayjs.extend(timezone)

type ServiceSourceRow = {
  total_services: string | number | null
  admin_services: string | number | null
  bot_services: string | number | null
  unidentified_services: string | number | null
}

type WhatsappLineRow = {
  wp_client_id: string
  alias: string | null
  sessions: string | number | null
  inbound_messages: string | number | null
  outbound_messages: string | number | null
}

class BillingRepository {
  async getLineCharges(): Promise<BillingLineCharge[]> {
    const rows = await sequelize.query<{ wp_client_id: string; alias: string; amount_cop: string }>(
      `SELECT w.id AS wp_client_id, w.alias, COALESCE(b.amount_cop, 0) AS amount_cop
       FROM wp_clients w
       LEFT JOIN billing_line_charges b ON b.wp_client_id = w.id
       ORDER BY w.alias ASC`,
      { type: QueryTypes.SELECT }
    )

    return rows.map((row) => ({
      wpClientId: row.wp_client_id,
      alias: row.alias,
      amountCop: Number(row.amount_cop),
    }))
  }

  async upsertLineCharges(charges: { wpClientId: string; amountCop: number }[]): Promise<void> {
    for (const charge of charges) {
      await BillingLineChargeRecord.upsert({
        wp_client_id: charge.wpClientId,
        amount_cop: charge.amountCop,
      })
    }
  }

  async getSoftwareRental(): Promise<number> {
    const row = await BillingSettingRecord.findByPk(SOFTWARE_RENTAL_KEY)
    return row ? Number(row.value_cop) : 0
  }

  async upsertSoftwareRental(amount: number): Promise<void> {
    await BillingSettingRecord.upsert({
      key: SOFTWARE_RENTAL_KEY,
      value_cop: amount,
    })
  }

  async getConfig(): Promise<BillingConfigResponse> {
    const [lineCharges, softwareRental] = await Promise.all([
      this.getLineCharges(),
      this.getSoftwareRental(),
    ])

    return { lineCharges, softwareRental }
  }

  async getSummary(month: string): Promise<BillingSummaryResponse> {
    const monthStart = dayjs
      .tz(`${month}-01 00:00:00`, 'YYYY-MM-DD HH:mm:ss', BILLING_TIMEZONE)
      .locale('es')
    const monthEnd = monthStart.endOf('month')
    const startUnix = monthStart.unix()
    const endUnix = monthEnd.unix()
    const startMs = monthStart.valueOf()
    const endMs = monthEnd.valueOf()

    const [sourceRow, whatsappLines] = await Promise.all([
      this.getServiceSourceSummary(startUnix, endUnix),
      this.getWhatsappLineSummary(startUnix, endUnix, startMs, endMs),
    ])

    const totalServices = toNumber(sourceRow?.total_services)
    const adminServices = toNumber(sourceRow?.admin_services)
    const botServices = toNumber(sourceRow?.bot_services)
    const unidentifiedServices = toNumber(sourceRow?.unidentified_services)

    const serviceSources: BillingSummarySource[] = [
      { key: 'admin', label: 'Panel admin', count: adminServices },
      { key: 'bot', label: 'Bot WhatsApp', count: botServices },
    ]

    if (unidentifiedServices > 0) {
      serviceSources.push({
        key: 'unidentified',
        label: 'Sin identificar',
        count: unidentifiedServices,
      })
    }

    const totalSessions = whatsappLines.reduce((sum, line) => sum + line.sessions, 0)
    const totalInboundMessages = whatsappLines.reduce((sum, line) => sum + line.inboundMessages, 0)
    const totalOutboundMessages = whatsappLines.reduce(
      (sum, line) => sum + line.outboundMessages,
      0
    )

    return {
      month,
      monthLabel: capitalize(monthStart.format('MMMM YYYY')),
      monthText: monthStart.format('MMMM [de] YYYY'),
      startDate: monthStart.format('YYYY-MM-DD'),
      endDate: monthEnd.format('YYYY-MM-DD'),
      startDateLabel: monthStart.format('D [de] MMMM [de] YYYY'),
      endDateLabel: monthEnd.format('D [de] MMMM [de] YYYY'),
      totalServices,
      totalSessions,
      totalInboundMessages,
      totalOutboundMessages,
      totalMessages: totalInboundMessages + totalOutboundMessages,
      serviceSources,
      whatsappLines,
    }
  }

  private async getServiceSourceSummary(
    startUnix: number,
    endUnix: number
  ): Promise<ServiceSourceRow | undefined> {
    const rows = await sequelize.query<ServiceSourceRow>(
      `SELECT
        COUNT(*) AS total_services,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(created_by), '') IS NOT NULL) AS admin_services,
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(created_by), '') IS NULL
            AND NULLIF(BTRIM(wp_client_id), '') IS NOT NULL
        ) AS bot_services,
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(created_by), '') IS NULL
            AND NULLIF(BTRIM(wp_client_id), '') IS NULL
        ) AS unidentified_services
      FROM service_history
      WHERE created_at BETWEEN :startUnix AND :endUnix`,
      {
        replacements: { startUnix, endUnix },
        type: QueryTypes.SELECT,
      }
    )

    return rows[0]
  }

  private async getWhatsappLineSummary(
    startUnix: number,
    endUnix: number,
    startMs: number,
    endMs: number
  ): Promise<BillingWhatsappLineSummary[]> {
    const rows = await sequelize.query<WhatsappLineRow>(
      `WITH session_counts AS (
        SELECT
          wp_client_id,
          COUNT(*) AS sessions
        FROM chat_sessions
        WHERE created_at BETWEEN :startMs AND :endMs
          AND NULLIF(BTRIM(wp_client_id), '') IS NOT NULL
        GROUP BY wp_client_id
      ),
      message_counts AS (
        SELECT
          wp_client_id,
          COUNT(*) FILTER (WHERE from_me = FALSE) AS inbound_messages,
          COUNT(*) FILTER (WHERE from_me = TRUE) AS outbound_messages
        FROM whatsapp_messages
        WHERE created_at BETWEEN :startUnix AND :endUnix
          AND NULLIF(BTRIM(wp_client_id), '') IS NOT NULL
        GROUP BY wp_client_id
      ),
      active_lines AS (
        SELECT wp_client_id FROM session_counts
        UNION
        SELECT wp_client_id FROM message_counts
      )
      SELECT
        active_lines.wp_client_id,
        NULLIF(BTRIM(w.alias), '') AS alias,
        COALESCE(session_counts.sessions, 0) AS sessions,
        COALESCE(message_counts.inbound_messages, 0) AS inbound_messages,
        COALESCE(message_counts.outbound_messages, 0) AS outbound_messages
      FROM active_lines
      LEFT JOIN session_counts ON session_counts.wp_client_id = active_lines.wp_client_id
      LEFT JOIN message_counts ON message_counts.wp_client_id = active_lines.wp_client_id
      LEFT JOIN wp_clients w ON w.id = active_lines.wp_client_id
      ORDER BY COALESCE(NULLIF(BTRIM(w.alias), ''), active_lines.wp_client_id) ASC`,
      {
        replacements: { startUnix, endUnix, startMs, endMs },
        type: QueryTypes.SELECT,
      }
    )

    return rows.map((row) => {
      const sessions = toNumber(row.sessions)
      const inboundMessages = toNumber(row.inbound_messages)
      const outboundMessages = toNumber(row.outbound_messages)

      return {
        wpClientId: row.wp_client_id,
        alias: row.alias || row.wp_client_id,
        sessions,
        inboundMessages,
        outboundMessages,
        totalMessages: inboundMessages + outboundMessages,
      }
    })
  }
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0)
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default BillingRepository
