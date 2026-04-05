import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('whatsapp_messages', {
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
    chat_session_id: {
      type: DataTypes.STRING(120),
      allowNull: true,
      references: {
        model: 'chat_sessions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    message_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    from_me: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    processed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    interactive: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    interactive_reply: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  })

  await queryInterface.addIndex('whatsapp_messages', ['wp_client_id', 'message_id'], {
    unique: true,
    name: 'whatsapp_messages_unique_wp_client_message',
  })
  await queryInterface.addIndex('whatsapp_messages', ['wp_client_id', 'chat_id', 'created_at'], {
    name: 'whatsapp_messages_wp_client_chat_created_at',
  })
  await queryInterface.addIndex('whatsapp_messages', ['chat_session_id', 'created_at'], {
    name: 'whatsapp_messages_chat_session_created_at',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('whatsapp_messages')
}
