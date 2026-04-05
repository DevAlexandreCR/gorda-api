import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'
import { ChatSessionRecordInterface } from '../Interfaces/ChatSessionRecordInterface'

class ChatSessionRecord
  extends Model<ChatSessionRecordInterface>
  implements ChatSessionRecordInterface
{
  public id!: string
  public wpClientId!: string
  public chatId!: string
  public status!: string
  public service_id!: string | null
  public place!: any
  public placeOptions!: any
  public notifications!: any
  public assigned_at!: number
  public created_at!: number
  public updated_at!: number | null
}

ChatSessionRecord.init(
  {
    id: {
      type: DataTypes.STRING(120),
      primaryKey: true,
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
    placeOptions: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'place_options',
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
  },
  {
    sequelize,
    tableName: 'chat_sessions',
    timestamps: false,
    indexes: [
      {
        name: 'chat_sessions_wp_client_status_created_at',
        fields: ['wp_client_id', 'status', 'created_at'],
      },
      {
        name: 'chat_sessions_wp_client_chat_created_at',
        fields: ['wp_client_id', 'chat_id', 'created_at'],
      },
    ],
  }
)

export default ChatSessionRecord
