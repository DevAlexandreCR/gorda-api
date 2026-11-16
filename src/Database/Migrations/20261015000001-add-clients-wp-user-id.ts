import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS wp_user_id VARCHAR(160) NULL
  `)
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_wp_user_id_unique ON clients (wp_user_id) WHERE wp_user_id IS NOT NULL
  `)
  await queryInterface.sequelize.query(`
    ALTER TABLE ignored_inbound_messages_audit ALTER COLUMN chat_id TYPE VARCHAR(160)
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS clients_wp_user_id_unique`)
  await queryInterface.sequelize.query(`ALTER TABLE clients DROP COLUMN IF EXISTS wp_user_id`)
  await queryInterface.sequelize.query(`
    ALTER TABLE ignored_inbound_messages_audit ALTER COLUMN chat_id TYPE VARCHAR(64)
  `)
}
