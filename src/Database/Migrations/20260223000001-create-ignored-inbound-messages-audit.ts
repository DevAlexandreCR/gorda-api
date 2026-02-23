import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('ignored_inbound_messages_audit', {
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
    provider: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    message_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    chat_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    reason: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    message_age_minutes: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    message_timestamp: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    received_at: {
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

  await queryInterface.addIndex('ignored_inbound_messages_audit', ['received_at'])
  await queryInterface.addIndex('ignored_inbound_messages_audit', ['wp_client_id', 'received_at'])
  await queryInterface.addIndex('ignored_inbound_messages_audit', ['provider', 'received_at'])
  await queryInterface.addIndex(
    'ignored_inbound_messages_audit',
    ['wp_client_id', 'provider', 'message_id', 'reason'],
    {
      unique: true,
      name: 'ignored_inbound_messages_audit_unique_message_reason',
    }
  )
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('ignored_inbound_messages_audit')
}
