import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('processed_inbound_messages', {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    wp_client_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    message_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    provider: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  })

  const sq = queryInterface.sequelize
  await sq.query(`CREATE INDEX IF NOT EXISTS "processed_inbound_messages_processed_at" ON "processed_inbound_messages" ("processed_at")`)
  await sq.query(`CREATE UNIQUE INDEX IF NOT EXISTS "processed_inbound_messages_unique_wp_client_message" ON "processed_inbound_messages" ("wp_client_id", "message_id")`)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('processed_inbound_messages')
}
