import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { WhatsappChatRecordInterface } from '../Interfaces/WhatsappChatRecordInterface'

type WhatsappChatCreationAttributes = Optional<WhatsappChatRecordInterface, 'id'>

class WhatsappChatRecord
  extends Model<WhatsappChatRecordInterface, WhatsappChatCreationAttributes>
  implements WhatsappChatRecordInterface
{
  public id!: number
  public wpClientId!: string
  public chatId!: string
  public clientName!: string
  public archived!: boolean
  public lastMessage!: any
  public created_at!: number
  public updated_at!: number
}

WhatsappChatRecord.init(
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
    clientName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'client_name',
    },
    archived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    lastMessage: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'last_message',
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'whatsapp_chats',
    timestamps: false,
    indexes: [
      {
        name: 'whatsapp_chats_unique_wp_client_chat',
        unique: true,
        fields: ['wp_client_id', 'chat_id'],
      },
      {
        name: 'whatsapp_chats_wp_client_updated_at',
        fields: ['wp_client_id', 'updated_at'],
      },
    ],
  }
)

export default WhatsappChatRecord
