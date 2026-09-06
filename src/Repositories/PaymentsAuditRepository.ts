import { QueryTypes } from 'sequelize'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import sequelize from '../Database/sequelize'
import { BOGOTA_TIMEZONE, periodStart, periodEnd } from '../Services/time/BogotaTime'
import {
  MonthlyPaymentsAuditQuery,
  RechargesAuditQuery,
  MonthlyPaymentAuditRow,
  RechargeAuditRow,
  PaymentsAuditSummaryRow,
  AuditTotals,
  AuditActor,
  RECHARGE_DUPLICATE_WINDOW_SECONDS,
} from '../Interfaces/PaymentsAuditInterface'

dayjs.extend(utc)
dayjs.extend(timezone)

const MONTHLY_ANOMALY_COLUMNS: Record<string, string> = {
  duplicate: 'anomaly_duplicate',
  atypical: 'anomaly_atypical',
  outOfPeriod: 'anomaly_out_of_period',
  voided: 'anomaly_voided',
}

const RECHARGE_ANOMALY_COLUMNS: Record<string, string> = {
  duplicate: 'anomaly_duplicate',
  atypical: 'anomaly_atypical',
}

const MONTHLY_SORT_WHITELIST = ['created_at', 'amount', 'period', 'driver_name']
const MONTHLY_SORT_COLUMNS: Record<string, string> = {
  created_at: 'mb.created_at',
  amount: 'mb.amount',
  period: 'mb.period',
  driver_name: 'd.name',
}

const RECHARGE_SORT_WHITELIST = ['created_at', 'amount', 'driver_name']
const RECHARGE_SORT_COLUMNS: Record<string, string> = {
  created_at: 'rb.created_at',
  amount: 'rb.amount',
  driver_name: 'd.name',
}

const SUMMARY_SORT_WHITELIST = ['driver_name', 'active_amount', 'payment_count', 'last_created_at']
const SUMMARY_SORT_COLUMNS: Record<string, string> = {
  driver_name: 'd.name',
  active_amount: '"activeAmount"',
  payment_count: '"paymentCount"',
  last_created_at: '"lastCreatedAt"',
}

/**
 * Cross-driver audit reads over `driver_monthly_payments` and `recharges`.
 * Every method builds a CTE bounded only by `period` (anomaly flags MUST be
 * computed before any other filter is applied, per the audit spec), then
 * applies the remaining filters, sort and pagination in an outer query.
 * Read-only: no method here mutates either ledger.
 */
class PaymentsAuditRepository {
  async listMonthly(
    query: MonthlyPaymentsAuditQuery
  ): Promise<{ rows: MonthlyPaymentAuditRow[]; total: number; totals: AuditTotals }> {
    const { cte, replacements: cteReplacements } = this.buildMonthlyCte(query)
    const { clauses, replacements: whereReplacements } = this.buildMonthlyWhere(query)
    const replacements = { ...cteReplacements, ...whereReplacements }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const sort = this.resolveSort(
      query.sort,
      MONTHLY_SORT_WHITELIST,
      MONTHLY_SORT_COLUMNS,
      '-created_at'
    )

    const page = Math.max(1, query.page)
    const limit = query.perPage
    const offset = (page - 1) * query.perPage

    const rowsSql = `
      ${cte}
      SELECT
        mb.id,
        mb.period,
        mb.amount,
        mb.status,
        mb.note,
        mb.created_by_uid AS "createdByUid",
        mb.created_by_name AS "createdByName",
        mb.created_at,
        mb.voided_at AS "voidedAt",
        mb.voided_by_uid AS "voidedByUid",
        mb.voided_by_name AS "voidedByName",
        mb.void_reason AS "voidReason",
        d.id AS "driverId",
        d.name AS "driverName",
        d.document AS "driverDocument",
        d.payment_mode AS "driverPaymentMode",
        (SELECT v.plate FROM vehicles v WHERE v.id = d.selected_vehicle_id) AS "driverPlate",
        mb.anomaly_duplicate AS "anomalyDuplicate",
        mb.anomaly_atypical AS "anomalyAtypical",
        mb.anomaly_out_of_period AS "anomalyOutOfPeriod",
        mb.anomaly_voided AS "anomalyVoided"
      FROM monthly_base mb
      JOIN drivers d ON d.id = mb.driver_id
      ${whereSql}
      ORDER BY ${sort}, mb.id ASC
      LIMIT :limit OFFSET :offset
    `

    const countSql = `
      ${cte}
      SELECT COUNT(*) AS count
      FROM monthly_base mb
      JOIN drivers d ON d.id = mb.driver_id
      ${whereSql}
    `

    const totalsSql = `
      ${cte}
      SELECT
        ROUND(COALESCE(SUM(mb.amount) FILTER (WHERE mb.status = 'active'), 0)::numeric, 2) AS "activeAmount",
        COUNT(*) FILTER (WHERE mb.status = 'active') AS "activeCount",
        COUNT(*) FILTER (WHERE mb.status = 'voided') AS "voidedCount",
        COUNT(DISTINCT mb.driver_id) FILTER (WHERE mb.status = 'active') AS "activeDriverCount"
      FROM monthly_base mb
      JOIN drivers d ON d.id = mb.driver_id
      ${whereSql}
    `

    const [rows, countRows, totalsRows] = await Promise.all([
      sequelize.query<any>(rowsSql, { replacements: { ...replacements, limit, offset }, type: QueryTypes.SELECT }),
      sequelize.query<any>(countSql, { replacements, type: QueryTypes.SELECT }),
      sequelize.query<any>(totalsSql, { replacements, type: QueryTypes.SELECT }),
    ])

    return {
      rows: rows.map((row) => this.mapMonthlyRow(row)),
      total: Number(countRows[0]?.count ?? 0),
      totals: this.mapTotals(totalsRows[0]),
    }
  }

  async listRecharges(
    query: RechargesAuditQuery
  ): Promise<{ rows: RechargeAuditRow[]; total: number; totals: AuditTotals }> {
    const { cte, replacements: cteReplacements } = this.buildRechargesCte(query)
    const { clauses, replacements: whereReplacements } = this.buildRechargesWhere(query)
    const replacements = { ...cteReplacements, ...whereReplacements }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const sort = this.resolveSort(
      query.sort,
      RECHARGE_SORT_WHITELIST,
      RECHARGE_SORT_COLUMNS,
      '-created_at'
    )

    const page = Math.max(1, query.page)
    const limit = query.perPage
    const offset = (page - 1) * query.perPage

    const rowsSql = `
      ${cte}
      SELECT
        rb.id,
        rb.amount,
        rb.balance_before AS "balanceBefore",
        rb.balance_after AS "balanceAfter",
        rb.note,
        rb.created_by_uid AS "createdByUid",
        rb.created_by_name AS "createdByName",
        rb.created_at,
        rb.period,
        d.id AS "driverId",
        d.name AS "driverName",
        d.document AS "driverDocument",
        d.payment_mode AS "driverPaymentMode",
        (SELECT v.plate FROM vehicles v WHERE v.id = d.selected_vehicle_id) AS "driverPlate",
        rb.anomaly_duplicate AS "anomalyDuplicate",
        rb.anomaly_atypical AS "anomalyAtypical"
      FROM recharges_base rb
      JOIN drivers d ON d.id = rb.driver_id
      ${whereSql}
      ORDER BY ${sort}, rb.id ASC
      LIMIT :limit OFFSET :offset
    `

    const countSql = `
      ${cte}
      SELECT COUNT(*) AS count
      FROM recharges_base rb
      JOIN drivers d ON d.id = rb.driver_id
      ${whereSql}
    `

    const totalsSql = `
      ${cte}
      SELECT
        ROUND(COALESCE(SUM(rb.amount), 0)::numeric, 2) AS "activeAmount",
        COUNT(*) AS "activeCount",
        0 AS "voidedCount",
        COUNT(DISTINCT rb.driver_id) AS "activeDriverCount"
      FROM recharges_base rb
      JOIN drivers d ON d.id = rb.driver_id
      ${whereSql}
    `

    const [rows, countRows, totalsRows] = await Promise.all([
      sequelize.query<any>(rowsSql, { replacements: { ...replacements, limit, offset }, type: QueryTypes.SELECT }),
      sequelize.query<any>(countSql, { replacements, type: QueryTypes.SELECT }),
      sequelize.query<any>(totalsSql, { replacements, type: QueryTypes.SELECT }),
    ])

    return {
      rows: rows.map((row) => this.mapRechargeRow(row)),
      total: Number(countRows[0]?.count ?? 0),
      totals: this.mapTotals(totalsRows[0]),
    }
  }

  async summaryMonthly(
    query: MonthlyPaymentsAuditQuery
  ): Promise<{ rows: PaymentsAuditSummaryRow[]; total: number; totals: AuditTotals }> {
    const { cte, replacements: cteReplacements } = this.buildMonthlyCte(query)
    const { clauses, replacements: whereReplacements } = this.buildMonthlyWhere(query)
    const replacements = { ...cteReplacements, ...whereReplacements }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const sort = this.resolveSort(
      query.sort,
      SUMMARY_SORT_WHITELIST,
      SUMMARY_SORT_COLUMNS,
      '-active_amount'
    )

    const page = Math.max(1, query.page)
    const limit = query.perPage
    const offset = (page - 1) * query.perPage

    const rowsSql = `
      ${cte}
      SELECT
        d.id AS "driverId",
        d.name AS "driverName",
        d.document AS "driverDocument",
        d.payment_mode AS "driverPaymentMode",
        (SELECT v.plate FROM vehicles v WHERE v.id = d.selected_vehicle_id) AS "driverPlate",
        ROUND(COALESCE(SUM(mb.amount) FILTER (WHERE mb.status = 'active'), 0)::numeric, 2) AS "activeAmount",
        COUNT(*) FILTER (WHERE mb.status = 'active') AS "paymentCount",
        COUNT(*) FILTER (WHERE mb.status = 'voided') AS "voidedCount",
        COUNT(*) FILTER (WHERE mb.anomaly_duplicate) AS "duplicateCount",
        COUNT(*) FILTER (WHERE mb.anomaly_atypical) AS "atypicalCount",
        COUNT(*) FILTER (WHERE mb.anomaly_out_of_period) AS "outOfPeriodCount",
        MAX(mb.created_at) AS "lastCreatedAt"
      FROM monthly_base mb
      JOIN drivers d ON d.id = mb.driver_id
      ${whereSql}
      GROUP BY d.id, d.name, d.document, d.payment_mode, d.selected_vehicle_id
      ORDER BY ${sort}, d.id ASC
      LIMIT :limit OFFSET :offset
    `

    const countSql = `
      ${cte}
      SELECT COUNT(*) AS count FROM (
        SELECT d.id
        FROM monthly_base mb
        JOIN drivers d ON d.id = mb.driver_id
        ${whereSql}
        GROUP BY d.id
      ) drivers_matched
    `

    const totalsSql = `
      ${cte}
      SELECT
        ROUND(COALESCE(SUM(mb.amount) FILTER (WHERE mb.status = 'active'), 0)::numeric, 2) AS "activeAmount",
        COUNT(*) FILTER (WHERE mb.status = 'active') AS "activeCount",
        COUNT(*) FILTER (WHERE mb.status = 'voided') AS "voidedCount",
        COUNT(DISTINCT mb.driver_id) FILTER (WHERE mb.status = 'active') AS "activeDriverCount"
      FROM monthly_base mb
      JOIN drivers d ON d.id = mb.driver_id
      ${whereSql}
    `

    const [rows, countRows, totalsRows] = await Promise.all([
      sequelize.query<any>(rowsSql, { replacements: { ...replacements, limit, offset }, type: QueryTypes.SELECT }),
      sequelize.query<any>(countSql, { replacements, type: QueryTypes.SELECT }),
      sequelize.query<any>(totalsSql, { replacements, type: QueryTypes.SELECT }),
    ])

    return {
      rows: rows.map((row) => this.mapSummaryRow(row, true)),
      total: Number(countRows[0]?.count ?? 0),
      totals: this.mapTotals(totalsRows[0]),
    }
  }

  async summaryRecharges(
    query: RechargesAuditQuery
  ): Promise<{ rows: PaymentsAuditSummaryRow[]; total: number; totals: AuditTotals }> {
    const { cte, replacements: cteReplacements } = this.buildRechargesCte(query)
    const { clauses, replacements: whereReplacements } = this.buildRechargesWhere(query)
    const replacements = { ...cteReplacements, ...whereReplacements }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const sort = this.resolveSort(
      query.sort,
      SUMMARY_SORT_WHITELIST,
      SUMMARY_SORT_COLUMNS,
      '-active_amount'
    )

    const page = Math.max(1, query.page)
    const limit = query.perPage
    const offset = (page - 1) * query.perPage

    const rowsSql = `
      ${cte}
      SELECT
        d.id AS "driverId",
        d.name AS "driverName",
        d.document AS "driverDocument",
        d.payment_mode AS "driverPaymentMode",
        (SELECT v.plate FROM vehicles v WHERE v.id = d.selected_vehicle_id) AS "driverPlate",
        ROUND(COALESCE(SUM(rb.amount), 0)::numeric, 2) AS "activeAmount",
        COUNT(*) AS "paymentCount",
        COUNT(*) FILTER (WHERE rb.anomaly_duplicate) AS "duplicateCount",
        COUNT(*) FILTER (WHERE rb.anomaly_atypical) AS "atypicalCount",
        MAX(rb.created_at) AS "lastCreatedAt"
      FROM recharges_base rb
      JOIN drivers d ON d.id = rb.driver_id
      ${whereSql}
      GROUP BY d.id, d.name, d.document, d.payment_mode, d.selected_vehicle_id
      ORDER BY ${sort}, d.id ASC
      LIMIT :limit OFFSET :offset
    `

    const countSql = `
      ${cte}
      SELECT COUNT(*) AS count FROM (
        SELECT d.id
        FROM recharges_base rb
        JOIN drivers d ON d.id = rb.driver_id
        ${whereSql}
        GROUP BY d.id
      ) drivers_matched
    `

    const totalsSql = `
      ${cte}
      SELECT
        ROUND(COALESCE(SUM(rb.amount), 0)::numeric, 2) AS "activeAmount",
        COUNT(*) AS "activeCount",
        0 AS "voidedCount",
        COUNT(DISTINCT rb.driver_id) AS "activeDriverCount"
      FROM recharges_base rb
      JOIN drivers d ON d.id = rb.driver_id
      ${whereSql}
    `

    const [rows, countRows, totalsRows] = await Promise.all([
      sequelize.query<any>(rowsSql, { replacements: { ...replacements, limit, offset }, type: QueryTypes.SELECT }),
      sequelize.query<any>(countSql, { replacements, type: QueryTypes.SELECT }),
      sequelize.query<any>(totalsSql, { replacements, type: QueryTypes.SELECT }),
    ])

    return {
      rows: rows.map((row) => this.mapSummaryRow(row, false)),
      total: Number(countRows[0]?.count ?? 0),
      totals: this.mapTotals(totalsRows[0]),
    }
  }

  /**
   * Distinct `created_by_uid` values for the given ledger, each with the most
   * recent `created_by_name` snapshot. Postgres requires the `DISTINCT ON`
   * ordering to lead with its own columns, so the final `ORDER BY name` is
   * applied in a wrapping select.
   */
  async listActors(type: 'monthly' | 'recharges'): Promise<AuditActor[]> {
    const table = type === 'monthly' ? 'driver_monthly_payments' : 'recharges'

    const sql = `
      SELECT uid, name FROM (
        SELECT DISTINCT ON (created_by_uid)
          created_by_uid AS uid,
          created_by_name AS name,
          created_at
        FROM ${table}
        ORDER BY created_by_uid, created_at DESC
      ) actors
      ORDER BY name
    `

    const rows = await sequelize.query<{ uid: string; name: string }>(sql, { type: QueryTypes.SELECT })
    return rows.map((row) => ({ uid: row.uid, name: row.name }))
  }

  /**
   * Monthly anomaly flags, bounded only by `period` (or the whole ledger when
   * omitted). `duplicate` counts active rows only, so a voided sibling never
   * causes another row to be flagged. `atypical` never compares against
   * `suggested_amount` — a negotiated rate is a legitimate override.
   */
  private buildMonthlyCte(query: MonthlyPaymentsAuditQuery): {
    cte: string
    replacements: Record<string, any>
  } {
    const replacements: Record<string, any> = {
      tz: BOGOTA_TIMEZONE,
      period: query.period ?? null,
      threshold: query.amountThreshold ?? null,
    }

    const cte = `
      WITH monthly_base AS (
        SELECT
          id,
          driver_id,
          period,
          amount,
          status,
          note,
          created_by_uid,
          created_by_name,
          created_at,
          voided_at,
          voided_by_uid,
          voided_by_name,
          void_reason,
          (
            status = 'active'
            AND COUNT(*) FILTER (WHERE status = 'active') OVER (PARTITION BY driver_id, period) > 1
          ) AS anomaly_duplicate,
          (to_char(timezone(:tz, to_timestamp(created_at)), 'YYYY-MM') <> period) AS anomaly_out_of_period,
          (amount = 0 OR (:threshold IS NOT NULL AND amount > :threshold)) AS anomaly_atypical,
          (status = 'voided') AS anomaly_voided
        FROM driver_monthly_payments
        WHERE (:period IS NULL OR period = :period)
      )
    `

    return { cte, replacements }
  }

  /**
   * Recharge anomaly flags. Because recharges have no intrinsic period, the
   * CTE input is bounded by `periodStart - RECHARGE_DUPLICATE_WINDOW_SECONDS`
   * / `periodEnd + RECHARGE_DUPLICATE_WINDOW_SECONDS` (not the strict
   * `period`) so a same-amount pair straddling the boundary is still seen by
   * LAG/LEAD; the strict `period` bound is applied in the outer WHERE.
   */
  private buildRechargesCte(query: RechargesAuditQuery): {
    cte: string
    replacements: Record<string, any>
  } {
    const boundStart = query.period
      ? periodStart(query.period) - RECHARGE_DUPLICATE_WINDOW_SECONDS
      : null
    const boundEnd = query.period
      ? periodEnd(query.period) + RECHARGE_DUPLICATE_WINDOW_SECONDS
      : null

    const replacements: Record<string, any> = {
      tz: BOGOTA_TIMEZONE,
      dupWindowSeconds: RECHARGE_DUPLICATE_WINDOW_SECONDS,
      minAmount: query.minAmount ?? null,
      maxAmount: query.maxAmount ?? null,
      rechargeBoundStart: boundStart,
      rechargeBoundEnd: boundEnd,
    }

    const cte = `
      WITH recharges_base AS (
        SELECT
          id,
          driver_id,
          amount,
          balance_before,
          balance_after,
          note,
          created_by_uid,
          created_by_name,
          created_at,
          to_char(timezone(:tz, to_timestamp(created_at)), 'YYYY-MM') AS period,
          (
            (LAG(created_at) OVER w IS NOT NULL AND created_at - LAG(created_at) OVER w <= :dupWindowSeconds)
            OR
            (LEAD(created_at) OVER w IS NOT NULL AND LEAD(created_at) OVER w - created_at <= :dupWindowSeconds)
          ) AS anomaly_duplicate,
          (
            (:minAmount IS NOT NULL AND amount < :minAmount)
            OR (:maxAmount IS NOT NULL AND amount > :maxAmount)
          ) AS anomaly_atypical
        FROM recharges
        WHERE (:rechargeBoundStart IS NULL OR created_at >= :rechargeBoundStart)
          AND (:rechargeBoundEnd IS NULL OR created_at <= :rechargeBoundEnd)
        WINDOW w AS (PARTITION BY driver_id, amount ORDER BY created_at)
      )
    `

    return { cte, replacements }
  }

  private buildMonthlyWhere(query: MonthlyPaymentsAuditQuery): {
    clauses: string[]
    replacements: Record<string, any>
  } {
    const clauses: string[] = []
    const replacements: Record<string, any> = {}

    if (query.driverSearch) {
      clauses.push(this.driverSearchClause('driverSearch'))
      replacements.driverSearch = `%${query.driverSearch}%`
    }

    if (query.createdFrom) {
      clauses.push('mb.created_at >= :createdFromUnix')
      replacements.createdFromUnix = this.dayStart(query.createdFrom)
    }

    if (query.createdTo) {
      clauses.push('mb.created_at <= :createdToUnix')
      replacements.createdToUnix = this.dayEnd(query.createdTo)
    }

    if (query.driverId) {
      clauses.push('mb.driver_id = :driverId')
      replacements.driverId = query.driverId
    }

    if (query.createdByUid) {
      clauses.push('mb.created_by_uid = :createdByUid')
      replacements.createdByUid = query.createdByUid
    }

    if (query.status) {
      clauses.push('mb.status = :status')
      replacements.status = query.status
    }

    const anomalyClause = this.buildAnomalyClause(query.anomaly, MONTHLY_ANOMALY_COLUMNS, 'mb')
    if (anomalyClause) clauses.push(anomalyClause)

    return { clauses, replacements }
  }

  private buildRechargesWhere(query: RechargesAuditQuery): {
    clauses: string[]
    replacements: Record<string, any>
  } {
    const clauses: string[] = []
    const replacements: Record<string, any> = {}

    if (query.period) {
      clauses.push('rb.period = :strictPeriod')
      replacements.strictPeriod = query.period
    }

    if (query.driverSearch) {
      clauses.push(this.driverSearchClause('driverSearch'))
      replacements.driverSearch = `%${query.driverSearch}%`
    }

    if (query.createdFrom) {
      clauses.push('rb.created_at >= :createdFromUnix')
      replacements.createdFromUnix = this.dayStart(query.createdFrom)
    }

    if (query.createdTo) {
      clauses.push('rb.created_at <= :createdToUnix')
      replacements.createdToUnix = this.dayEnd(query.createdTo)
    }

    if (query.driverId) {
      clauses.push('rb.driver_id = :driverId')
      replacements.driverId = query.driverId
    }

    if (query.createdByUid) {
      clauses.push('rb.created_by_uid = :createdByUid')
      replacements.createdByUid = query.createdByUid
    }

    const anomalyClause = this.buildAnomalyClause(query.anomaly, RECHARGE_ANOMALY_COLUMNS, 'rb')
    if (anomalyClause) clauses.push(anomalyClause)

    return { clauses, replacements }
  }

  /** Same plate `IN (SELECT ...)` subquery pattern as `DriverRecordRepository.list`, plus name/document ILIKE. Deliberately no email/phone match. */
  private driverSearchClause(paramName: string): string {
    return `(
      d.name ILIKE :${paramName}
      OR d.document ILIKE :${paramName}
      OR d.id IN (
        SELECT dv.driver_id FROM driver_vehicles dv
        JOIN vehicles v ON v.id = dv.vehicle_id
        WHERE v.plate ILIKE :${paramName}
      )
    )`
  }

  private buildAnomalyClause(
    anomaly: string[] | undefined,
    columns: Record<string, string>,
    alias: string
  ): string | null {
    if (!anomaly || anomaly.length === 0) return null
    const parts = anomaly.filter((flag) => columns[flag]).map((flag) => `${alias}.${columns[flag]}`)
    if (parts.length === 0) return null
    return `(${parts.join(' OR ')})`
  }

  private dayStart(day: string): number {
    return dayjs.tz(day, BOGOTA_TIMEZONE).startOf('day').unix()
  }

  private dayEnd(day: string): number {
    return dayjs.tz(day, BOGOTA_TIMEZONE).endOf('day').unix()
  }

  private resolveSort(
    sortRaw: string | undefined,
    whitelist: string[],
    columns: Record<string, string>,
    defaultSort: string
  ): string {
    const raw = sortRaw ?? defaultSort
    const descending = raw.startsWith('-')
    const field = descending ? raw.slice(1) : raw
    if (!whitelist.includes(field)) {
      throw new Error(`Invalid sort field: "${field}". Allowed: ${whitelist.join(', ')}`)
    }
    return `${columns[field]} ${descending ? 'DESC' : 'ASC'}`
  }

  private mapMonthlyRow(row: any): MonthlyPaymentAuditRow {
    return {
      id: row.id,
      period: row.period,
      amount: Number(row.amount),
      status: row.status,
      note: row.note ?? null,
      createdByUid: row.createdByUid,
      createdByName: row.createdByName,
      created_at: Number(row.created_at),
      voidedAt: row.voidedAt !== null && row.voidedAt !== undefined ? Number(row.voidedAt) : null,
      voidedByUid: row.voidedByUid ?? null,
      voidedByName: row.voidedByName ?? null,
      voidReason: row.voidReason ?? null,
      driver: {
        id: row.driverId,
        name: row.driverName,
        document: row.driverDocument,
        plate: row.driverPlate ?? null,
        paymentMode: row.driverPaymentMode ?? undefined,
      },
      anomalies: {
        duplicate: Boolean(row.anomalyDuplicate),
        atypical: Boolean(row.anomalyAtypical),
        outOfPeriod: Boolean(row.anomalyOutOfPeriod),
        voided: Boolean(row.anomalyVoided),
      },
    }
  }

  private mapRechargeRow(row: any): RechargeAuditRow {
    return {
      id: row.id,
      amount: Number(row.amount),
      balanceBefore: Number(row.balanceBefore),
      balanceAfter: Number(row.balanceAfter),
      note: row.note ?? null,
      createdByUid: row.createdByUid,
      createdByName: row.createdByName,
      created_at: Number(row.created_at),
      period: row.period,
      driver: {
        id: row.driverId,
        name: row.driverName,
        document: row.driverDocument,
        plate: row.driverPlate ?? null,
        paymentMode: row.driverPaymentMode ?? undefined,
      },
      anomalies: {
        duplicate: Boolean(row.anomalyDuplicate),
        atypical: Boolean(row.anomalyAtypical),
        outOfPeriod: false,
        voided: false,
      },
    }
  }

  private mapSummaryRow(row: any, includeMonthlyOnlyCounts: boolean): PaymentsAuditSummaryRow {
    const summary: PaymentsAuditSummaryRow = {
      driver: {
        id: row.driverId,
        name: row.driverName,
        document: row.driverDocument,
        plate: row.driverPlate ?? null,
        paymentMode: row.driverPaymentMode ?? undefined,
      },
      activeAmount: Number(row.activeAmount ?? 0),
      paymentCount: Number(row.paymentCount ?? 0),
      duplicateCount: Number(row.duplicateCount ?? 0),
      atypicalCount: Number(row.atypicalCount ?? 0),
      lastCreatedAt: Number(row.lastCreatedAt ?? 0),
    }

    if (includeMonthlyOnlyCounts) {
      summary.voidedCount = Number(row.voidedCount ?? 0)
      summary.outOfPeriodCount = Number(row.outOfPeriodCount ?? 0)
    }

    return summary
  }

  private mapTotals(row: any): AuditTotals {
    return {
      activeAmount: Number(row?.activeAmount ?? 0),
      activeCount: Number(row?.activeCount ?? 0),
      voidedCount: Number(row?.voidedCount ?? 0),
      activeDriverCount: Number(row?.activeDriverCount ?? 0),
    }
  }
}

export default PaymentsAuditRepository
