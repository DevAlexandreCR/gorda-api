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
