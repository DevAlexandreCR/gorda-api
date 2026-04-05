import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('chat_sessions', {
    id: {
      type: DataTypes.STRING(120),
      primaryKey: true,
      allowNull: false,
    },
    wp_client_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    chat_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    service_id: {
      type: DataTypes.STRING(191),
      allowNull: true,
    },
    place: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    place_options: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    notifications: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    assigned_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  })

  await queryInterface.addIndex('chat_sessions', ['wp_client_id', 'status', 'created_at'], {
    name: 'chat_sessions_wp_client_status_created_at',
  })
  await queryInterface.addIndex('chat_sessions', ['wp_client_id', 'chat_id', 'created_at'], {
    name: 'chat_sessions_wp_client_chat_created_at',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('chat_sessions')
}
