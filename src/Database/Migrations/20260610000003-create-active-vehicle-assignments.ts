import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS active_vehicle_assignments (
      vehicle_id UUID NOT NULL,
      driver_id VARCHAR(128) NOT NULL,
      session_id VARCHAR(100),
      acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT active_vehicle_assignments_pkey PRIMARY KEY (vehicle_id),
      CONSTRAINT active_vehicle_assignments_driver_id_key UNIQUE (driver_id),
      CONSTRAINT active_vehicle_assignments_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      CONSTRAINT active_vehicle_assignments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id)
    )
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS active_vehicle_assignments`)
}
