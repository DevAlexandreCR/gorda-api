// Business rule: a vehicle must be DISABLED unless its data is complete.
// "Complete" = brand non-empty, model non-empty, color not null,
// soat_exp not null, tec_exp not null (presence only — no expiry check).
//
// This migration disables every currently-enabled vehicle that fails the
// completeness check. It records the affected IDs in a backup table so
// the down migration can re-enable exactly those rows.
//
// NOTE: Run this pre-flight count before applying in production to assess
// scope before committing:
//
//   SELECT count(*) FROM vehicles
//   WHERE enabled = true
//     AND (
//       brand IS NULL OR brand = '' OR
//       model IS NULL OR model = '' OR
//       color IS NULL OR
//       soat_exp IS NULL OR
//       tec_exp IS NULL
//     );

import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (t) => {
    // Step 1: record which vehicles will be disabled so down() can reverse exactly these rows.
    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS vehicles_disabled_incomplete_backup AS
      SELECT id FROM vehicles
      WHERE enabled = true
        AND (
          brand IS NULL OR brand = '' OR
          model IS NULL OR model = '' OR
          color IS NULL OR
          soat_exp IS NULL OR
          tec_exp IS NULL
        )
    `,
      { transaction: t }
    )

    // Step 2: disable every enabled vehicle that is missing required fields.
    // Idempotent: re-running finds no enabled=true rows matching the predicate.
    await queryInterface.sequelize.query(
      `
      UPDATE vehicles
      SET enabled = false, updated_at = NOW()
      WHERE enabled = true
        AND (
          brand IS NULL OR brand = '' OR
          model IS NULL OR model = '' OR
          color IS NULL OR
          soat_exp IS NULL OR
          tec_exp IS NULL
        )
    `,
      { transaction: t }
    )
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // Re-enable only the rows that this migration disabled, then remove the backup table.
  await queryInterface.sequelize.query(`
    UPDATE vehicles
    SET enabled = true, updated_at = NOW()
    WHERE id IN (
      SELECT id FROM vehicles_disabled_incomplete_backup
    )
  `)
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS vehicles_disabled_incomplete_backup`)
}
