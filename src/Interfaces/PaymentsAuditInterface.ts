export const RECHARGE_DUPLICATE_WINDOW_SECONDS = 600

export type PaymentsAuditSortDirection = 'asc' | 'desc'

export interface PaymentsAuditQuery {
  period?: string
  createdFrom?: string
  createdTo?: string
  driverSearch?: string
  driverId?: string
  createdByUid?: string
  anomaly?: string[]
  sort?: string
  page: number
  perPage: number
}

export interface MonthlyPaymentsAuditQuery extends PaymentsAuditQuery {
  status?: 'active' | 'voided'
  amountThreshold?: number
}

export interface RechargesAuditQuery extends PaymentsAuditQuery {
  minAmount?: number
  maxAmount?: number
}

export interface AuditDriver {
  id: string
  name: string
  document: string
  plate: string | null
  paymentMode?: string
}

export interface AuditAnomalies {
  duplicate: boolean
  atypical: boolean
  outOfPeriod: boolean
  voided: boolean
}

export interface MonthlyPaymentAuditRow {
  id: string
  period: string
  amount: number
  status: string
  note: string | null
  createdByUid: string
  createdByName: string
  created_at: number
  voidedAt: number | null
  voidedByUid: string | null
  voidedByName: string | null
  voidReason: string | null
  driver: AuditDriver
  anomalies: AuditAnomalies
}

export interface RechargeAuditRow {
  id: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  note: string | null
  createdByUid: string
  createdByName: string
  created_at: number
  period: string
  driver: AuditDriver
  anomalies: AuditAnomalies
}

export interface PaymentsAuditSummaryRow {
  driver: AuditDriver
  activeAmount: number
  paymentCount: number
  voidedCount?: number
  duplicateCount: number
  atypicalCount: number
  outOfPeriodCount?: number
  lastCreatedAt: number
}

export interface AuditTotals {
  activeAmount: number
  activeCount: number
  voidedCount: number
  activeDriverCount: number
}

export interface AuditActor {
  uid: string
  name: string
}
