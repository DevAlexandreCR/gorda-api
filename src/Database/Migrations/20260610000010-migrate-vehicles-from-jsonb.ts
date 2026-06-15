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
      WITH vehicle_source AS (
        SELECT
          UPPER(REPLACE(REPLACE(vehicle->>'plate', ' ', ''), '-', '')) AS normalized_plate,
          NULLIF(BTRIM(vehicle->>'brand'), '') AS brand,
          NULLIF(BTRIM(vehicle->>'model'), '') AS model,
          CASE
            WHEN vehicle->>'color' IS NOT NULL AND vehicle->>'color' != 'null'
            THEN (
              CASE jsonb_typeof(vehicle->'color')
                WHEN 'object' THEN vehicle->'color'
                ELSE jsonb_build_object('name', vehicle->>'color')
              END
            )
            ELSE NULL
          END AS color,
          NULLIF(BTRIM(COALESCE(vehicle->>'photoUrl', vehicle->>'photo_url')), '') AS photo_url,
          CASE
            WHEN NULLIF(BTRIM(vehicle->>'soat_exp'), '') IS NULL THEN NULL
            WHEN BTRIM(vehicle->>'soat_exp') ~ '^\\d{13}$'
              THEN to_timestamp((BTRIM(vehicle->>'soat_exp'))::double precision / 1000.0)
            WHEN BTRIM(vehicle->>'soat_exp') ~ '^\\d{10}$'
              THEN to_timestamp((BTRIM(vehicle->>'soat_exp'))::double precision)
            WHEN BTRIM(vehicle->>'soat_exp') ~ '^\\d{4}-\\d{2}-\\d{2}'
              AND to_char(to_date(LEFT(BTRIM(vehicle->>'soat_exp'), 10), 'YYYY-MM-DD'), 'YYYY-MM-DD') = LEFT(BTRIM(vehicle->>'soat_exp'), 10)
              THEN to_date(LEFT(BTRIM(vehicle->>'soat_exp'), 10), 'YYYY-MM-DD')::timestamp
            ELSE NULL
          END AS soat_exp,
          CASE
            WHEN NULLIF(BTRIM(vehicle->>'tec_exp'), '') IS NULL THEN NULL
            WHEN BTRIM(vehicle->>'tec_exp') ~ '^\\d{13}$'
              THEN to_timestamp((BTRIM(vehicle->>'tec_exp'))::double precision / 1000.0)
            WHEN BTRIM(vehicle->>'tec_exp') ~ '^\\d{10}$'
              THEN to_timestamp((BTRIM(vehicle->>'tec_exp'))::double precision)
            WHEN BTRIM(vehicle->>'tec_exp') ~ '^\\d{4}-\\d{2}-\\d{2}'
              AND to_char(to_date(LEFT(BTRIM(vehicle->>'tec_exp'), 10), 'YYYY-MM-DD'), 'YYYY-MM-DD') = LEFT(BTRIM(vehicle->>'tec_exp'), 10)
              THEN to_date(LEFT(BTRIM(vehicle->>'tec_exp'), 10), 'YYYY-MM-DD')::timestamp
            ELSE NULL
          END AS tec_exp
        FROM drivers
        WHERE vehicle IS NOT NULL
          AND vehicle != '{}'::jsonb
          AND vehicle->>'plate' IS NOT NULL
          AND vehicle->>'plate' != ''
      )
      INSERT INTO vehicles (id, plate, brand, model, color, photo_url, soat_exp, tec_exp, enabled, created_at, updated_at)
      SELECT DISTINCT ON (normalized_plate)
        gen_random_uuid(),
        normalized_plate,
        brand,
        model,
        color,
        photo_url,
        soat_exp,
        tec_exp,
        CASE
          WHEN brand IS NOT NULL
            AND model IS NOT NULL
            AND color IS NOT NULL
            AND soat_exp IS NOT NULL
            AND tec_exp IS NOT NULL
          THEN true
          ELSE false
        END,
        NOW(),
        NOW()
      FROM vehicle_source
      WHERE normalized_plate IS NOT NULL AND normalized_plate != ''
      ORDER BY
        normalized_plate,
        (brand IS NOT NULL) DESC,
        (model IS NOT NULL) DESC,
        (color IS NOT NULL) DESC,
        (photo_url IS NOT NULL) DESC,
        (soat_exp IS NOT NULL) DESC,
        (tec_exp IS NOT NULL) DESC
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

    // Step 6: keep the legacy JSONB column while the current model still reads it.
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
