import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE chat_sessions
      ADD COLUMN IF NOT EXISTS state JSONB DEFAULT '{}'::jsonb NOT NULL
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE chat_sessions DROP COLUMN IF EXISTS state`)
}
