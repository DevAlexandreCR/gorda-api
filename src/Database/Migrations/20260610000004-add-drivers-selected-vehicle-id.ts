import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE drivers
      ADD COLUMN IF NOT EXISTS selected_vehicle_id UUID NULL
  `)

  await queryInterface.sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'drivers_selected_vehicle_id_fkey'
      ) THEN
        ALTER TABLE drivers
          ADD CONSTRAINT drivers_selected_vehicle_id_fkey
          FOREIGN KEY (selected_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE drivers DROP COLUMN IF EXISTS selected_vehicle_id
  `)
}
