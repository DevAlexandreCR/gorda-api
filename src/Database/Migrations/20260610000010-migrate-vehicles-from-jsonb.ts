import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (t) => {
    // Step 0: create backup table
    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS drivers_vehicle_backup AS
      SELECT id AS driver_id, vehicle FROM drivers WHERE vehicle IS NOT NULL
    `,
      { transaction: t }
    )

    // Step 1: dedupe vehicles from JSONB into vehicles table
    // normalized plate = UPPER(REPLACE(REPLACE(vehicle->>'plate', ' ', ''), '-', ''))
    await queryInterface.sequelize.query(
      `
      INSERT INTO vehicles (id, plate, brand, model, color, photo_url, soat_exp, tec_exp, enabled, created_at, updated_at)
      SELECT DISTINCT ON (UPPER(REPLACE(REPLACE(vehicle->>'plate', ' ', ''), '-', '')))
        gen_random_uuid(),
        UPPER(REPLACE(REPLACE(vehicle->>'plate', ' ', ''), '-', '')),
        vehicle->>'brand',
        vehicle->>'model',
        CASE
          WHEN vehicle->>'color' IS NOT NULL AND vehicle->>'color' != 'null'
          THEN (
            CASE jsonb_typeof(vehicle->'color')
              WHEN 'object' THEN vehicle->'color'
              ELSE jsonb_build_object('name', vehicle->>'color')
            END
          )
          ELSE NULL
        END,
        vehicle->>'photo_url',
        NULL,
        NULL,
        -- enabled=false if plate/brand/model missing, or soat_exp/tec_exp absent.
        -- Rule tightened retroactively: soat_exp and tec_exp are always NULL at
        -- migration time (drivers provided them separately), so all freshly-migrated
        -- vehicles start disabled. Data fix for already-migrated DBs is handled by
        -- 20260610000012-disable-incomplete-vehicles.ts.
        CASE WHEN
          (vehicle->>'plate' IS NULL OR vehicle->>'plate' = '') OR
          (vehicle->>'brand' IS NULL OR vehicle->>'brand' = '') OR
          (vehicle->>'model' IS NULL OR vehicle->>'model' = '') OR
          vehicle->>'soat_exp' IS NULL OR
          vehicle->>'tec_exp' IS NULL
        THEN false ELSE true END,
        NOW(), NOW()
      FROM drivers
      WHERE vehicle IS NOT NULL AND vehicle != '{}'::jsonb
        AND vehicle->>'plate' IS NOT NULL AND vehicle->>'plate' != ''
      ON CONFLICT (plate) DO NOTHING
    `,
      { transaction: t }
    )

    // Step 2: insert driver_vehicles links
    await queryInterface.sequelize.query(
      `
      INSERT INTO driver_vehicles (id, driver_id, vehicle_id, selectable, added_at, updated_at)
      SELECT
        gen_random_uuid(),
        d.id,
        v.id,
        true,
        NOW(),
        NOW()
      FROM drivers d
      JOIN vehicles v ON v.plate = UPPER(REPLACE(REPLACE(d.vehicle->>'plate', ' ', ''), '-', ''))
      WHERE d.vehicle IS NOT NULL
        AND d.vehicle->>'plate' IS NOT NULL AND d.vehicle->>'plate' != ''
      ON CONFLICT (driver_id, vehicle_id) DO NOTHING
    `,
      { transaction: t }
    )

    // Step 3: set selected_vehicle_id
    await queryInterface.sequelize.query(
      `
      UPDATE drivers d
      SET selected_vehicle_id = v.id
      FROM vehicles v
      WHERE v.plate = UPPER(REPLACE(REPLACE(d.vehicle->>'plate', ' ', ''), '-', ''))
        AND d.vehicle->>'plate' IS NOT NULL AND d.vehicle->>'plate' != ''
        AND d.selected_vehicle_id IS NULL
    `,
      { transaction: t }
    )

    // Step 4: inactivate drivers with no usable vehicle
    await queryInterface.sequelize.query(
      `
      UPDATE drivers
      SET enabled_at = 0
      WHERE selected_vehicle_id IS NULL
        AND enabled_at > 0
        AND (vehicle IS NULL OR vehicle = '{}'::jsonb OR vehicle->>'plate' IS NULL OR vehicle->>'plate' = '')
    `,
      { transaction: t }
    )

    // Step 5: best-effort backfill service_history.vehicle_id
    await queryInterface.sequelize.query(
      `
      UPDATE service_history sh
      SET vehicle_id = v.id
      FROM vehicles v
      JOIN drivers d ON v.id = d.selected_vehicle_id
      WHERE sh.driver_id = d.id
        AND sh.vehicle_id IS NULL
    `,
      { transaction: t }
    )

    // Step 6: drop the legacy JSONB column now that all data is migrated
    await queryInterface.sequelize.query(`ALTER TABLE drivers DROP COLUMN IF EXISTS vehicle`, {
      transaction: t,
    })
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle JSONB DEFAULT '{}'::jsonb NOT NULL`
  )
  await queryInterface.sequelize.query(
    `UPDATE drivers d SET vehicle = b.vehicle FROM drivers_vehicle_backup b WHERE b.driver_id = d.id`
  )
  await queryInterface.sequelize.query(`UPDATE drivers SET selected_vehicle_id = NULL`)
  await queryInterface.sequelize.query(`DELETE FROM driver_vehicles`)
  await queryInterface.sequelize.query(`DELETE FROM vehicles`)
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS drivers_vehicle_backup`)
}
