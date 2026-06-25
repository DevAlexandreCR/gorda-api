export interface MonthlyPaymentSettingsInterface {
  id: string
  suggested_amount: number
  auto_disable: boolean
  cutoff_day: number
  reminder_offsets: number[]
  updated_at: Date
}
