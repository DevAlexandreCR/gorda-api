import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE drivers
      ADD COLUMN selected_vehicle_id UUID NULL,
      ADD CONSTRAINT drivers_selected_vehicle_id_fkey
        FOREIGN KEY (selected_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE drivers DROP COLUMN IF EXISTS selected_vehicle_id
  `)
}
