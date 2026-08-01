import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE ride_fee_settings
      ADD COLUMN IF NOT EXISTS self_service_cancel_window INTEGER NOT NULL DEFAULT 120
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE ride_fee_settings DROP COLUMN IF EXISTS self_service_cancel_window`
  )
}
