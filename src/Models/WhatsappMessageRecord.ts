import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { WhatsappMessageRecordInterface } from '../Interfaces/WhatsappMessageRecordInterface'

type WhatsappMessageCreationAttributes = Optional<WhatsappMessageRecordInterface, 'id'>

class WhatsappMessageRecord
  extends Model<WhatsappMessageRecordInterface, WhatsappMessageCreationAttributes>
  implements WhatsappMessageRecordInterface
{
  public id!: number
  public wpClientId!: string
  public chatId!: string
  public chatSessionId!: string | null
  public messageId!: string
  public created_at!: number
  public type!: any
  public body!: string
  public fromMe!: boolean
  public processed!: boolean
  public location!: any
  public interactive!: any
  public interactiveReply!: any
}

WhatsappMessageRecord.init(
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    wpClientId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'wp_client_id',
    },
    chatId: {
      type: DataTypes.STRING(191),
      allowNull: false,
      field: 'chat_id',
    },
    chatSessionId: {
      type: DataTypes.STRING(120),
      allowNull: true,
      field: 'chat_session_id',
    },
    messageId: {
      type: DataTypes.STRING(191),
      allowNull: false,
      field: 'message_id',
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
    fromMe: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'from_me',
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
    interactiveReply: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'interactive_reply',
    },
  },
  {
    sequelize,
    tableName: 'whatsapp_messages',
    timestamps: false,
    indexes: [
      {
        name: 'whatsapp_messages_unique_wp_client_message',
        unique: true,
        fields: ['wp_client_id', 'message_id'],
      },
      {
        name: 'whatsapp_messages_wp_client_chat_created_at',
        fields: ['wp_client_id', 'chat_id', 'created_at'],
      },
      {
        name: 'whatsapp_messages_chat_session_created_at',
        fields: ['chat_session_id', 'created_at'],
      },
    ],
  }
)

export default WhatsappMessageRecord
