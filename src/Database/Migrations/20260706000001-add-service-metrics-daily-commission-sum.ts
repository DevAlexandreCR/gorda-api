import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE service_metrics_daily
      ADD COLUMN IF NOT EXISTS commission_sum FLOAT NOT NULL DEFAULT 0
  `)

  // Defensive/idempotent: both indexes already exist as of migrations
  // 20260404000001-create-service-history.ts (service_history_status_created_at)
  // and 20260615000001-create-recharges.ts (recharges_created_at_idx). Re-asserted
  // here with IF NOT EXISTS + matching names so revenue aggregation queries stay
  // index-backed even on environments where migration history has drifted.
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS service_history_status_created_at
      ON service_history (status, created_at)
  `)

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS recharges_created_at_idx
      ON recharges (created_at)
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // Indexes predate this migration (owned by the migrations noted above) and are
  // left untouched on rollback; only the column this migration added is dropped.
  await queryInterface.sequelize.query(
    `ALTER TABLE service_metrics_daily DROP COLUMN IF EXISTS commission_sum`
  )
}
