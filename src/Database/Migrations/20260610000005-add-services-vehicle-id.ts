import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE service_history
      ADD COLUMN IF NOT EXISTS vehicle_id UUID NULL
  `)
  await queryInterface.sequelize.query(`
    ALTER TABLE service_history
      DROP CONSTRAINT IF EXISTS service_history_vehicle_id_fkey,
      ADD CONSTRAINT service_history_vehicle_id_fkey
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
  `)
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS service_history_vehicle_id_idx ON service_history(vehicle_id)
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS service_history_vehicle_id_idx`)
  await queryInterface.sequelize.query(
    `ALTER TABLE service_history DROP COLUMN IF EXISTS vehicle_id`
  )
}
