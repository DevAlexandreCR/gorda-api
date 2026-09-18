import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE wp_clients
      ADD COLUMN IF NOT EXISTS agent_in_trip BOOLEAN DEFAULT false NOT NULL
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE wp_clients DROP COLUMN IF EXISTS agent_in_trip`)
}
