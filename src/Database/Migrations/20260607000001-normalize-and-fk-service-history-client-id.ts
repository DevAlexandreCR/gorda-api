import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (t) => {
    // Pre-flight check: clients.id must already be canonical
    const [preFlightRows] = await queryInterface.sequelize.query(
      `SELECT COUNT(*)::int AS n FROM clients WHERE id !~ '^\\d+$'`,
      { transaction: t }
    )
    const preFlightCount = (preFlightRows as any[])[0].n
    if (preFlightCount > 0) {
      throw new Error(
        `Migration aborted: clients.id contains non-canonical values (count: ${preFlightCount}). Normalize clients.id before running this migration.`
      )
    }

    // Backfill: strip @suffix, trim whitespace, remove leading +
    await queryInterface.sequelize.query(
      `UPDATE service_history
       SET client_id = regexp_replace(btrim(split_part(client_id, '@', 1)), '^\\+', '')
       WHERE client_id !~ '^\\d+$'`,
      { transaction: t }
    )

    // Invariant A: all service_history rows must now be canonical
    const [invariantARows] = await queryInterface.sequelize.query(
      `SELECT COUNT(*)::int AS n FROM service_history WHERE client_id !~ '^\\d+$'`,
      { transaction: t }
    )
    const invariantACount = (invariantARows as any[])[0].n
    if (invariantACount > 0) {
      throw new Error(
        `Migration aborted: ${invariantACount} service_history rows remain non-canonical after backfill.`
      )
    }

    // Invariant B: all service_history.client_id values must have a matching clients row
    const [invariantBRows] = await queryInterface.sequelize.query(
      `SELECT COUNT(*)::int AS n
       FROM service_history sh
       LEFT JOIN clients c ON c.id = sh.client_id
       WHERE c.id IS NULL`,
      { transaction: t }
    )
    const invariantBCount = (invariantBRows as any[])[0].n
    if (invariantBCount > 0) {
      throw new Error(
        `Migration aborted: ${invariantBCount} service_history rows have no matching client after normalization.`
      )
    }

    // Narrow the column type
    await queryInterface.sequelize.query(
      `ALTER TABLE service_history ALTER COLUMN client_id TYPE VARCHAR(50)`,
      { transaction: t }
    )

    // Create composite index
    await queryInterface.sequelize.query(
      `CREATE INDEX service_history_client_id_status_created_at ON service_history (client_id, status, created_at)`,
      { transaction: t }
    )

    // Add foreign key constraint
    await queryInterface.sequelize.query(
      `ALTER TABLE service_history ADD CONSTRAINT service_history_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT`,
      { transaction: t }
    )
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE service_history DROP CONSTRAINT IF EXISTS service_history_client_id_fkey`
  )

  await queryInterface.sequelize.query(
    `DROP INDEX IF EXISTS service_history_client_id_status_created_at`
  )

  await queryInterface.sequelize.query(
    `ALTER TABLE service_history ALTER COLUMN client_id TYPE VARCHAR(128)`
  )
}
