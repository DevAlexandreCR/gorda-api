import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE service_history
      ADD COLUMN IF NOT EXISTS deducted_value FLOAT NOT NULL DEFAULT 0
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE service_history DROP COLUMN IF EXISTS deducted_value`
  )
}
