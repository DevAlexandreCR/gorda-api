export interface BillingLineCharge {
  wpClientId: string
  alias: string
  amountCop: number
}

export interface BillingSetting {
  key: string
  valueCop: number
}

export interface BillingConfigResponse {
  lineCharges: BillingLineCharge[]
  softwareRental: number
}

export interface BillingExtra {
  description: string
  amountCop: number
}

export interface BillingSendPayload {
  month: string
  recipientEmail: string
  extras: BillingExtra[]
}

export interface BillingSummarySource {
  key: 'admin' | 'bot' | 'unidentified'
  label: string
  count: number
}

export interface BillingWhatsappLineSummary {
  wpClientId: string
  alias: string
  sessions: number
  inboundMessages: number
  outboundMessages: number
  totalMessages: number
}

export interface BillingSummaryResponse {
  month: string
  monthLabel: string
  monthText: string
  startDate: string
  endDate: string
  startDateLabel: string
  endDateLabel: string
  totalServices: number
  totalSessions: number
  totalInboundMessages: number
  totalOutboundMessages: number
  totalMessages: number
  serviceSources: BillingSummarySource[]
  whatsappLines: BillingWhatsappLineSummary[]
}
