import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('whatsapp_chats', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
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
    client_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    archived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    last_message: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  })

  await queryInterface.addIndex('whatsapp_chats', ['wp_client_id', 'chat_id'], {
    unique: true,
    name: 'whatsapp_chats_unique_wp_client_chat',
  })
  await queryInterface.addIndex('whatsapp_chats', ['wp_client_id', 'updated_at'], {
    name: 'whatsapp_chats_wp_client_updated_at',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('whatsapp_chats')
}
