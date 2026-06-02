import { QueryTypes } from 'sequelize'
import sequelize from '../Database/sequelize'
import BillingLineChargeRecord from '../Models/BillingLineChargeRecord'
import BillingSettingRecord from '../Models/BillingSettingRecord'
import { BillingConfigResponse, BillingLineCharge } from '../Interfaces/BillingInterface'

const SOFTWARE_RENTAL_KEY = 'software_rental'

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
}

export default BillingRepository
