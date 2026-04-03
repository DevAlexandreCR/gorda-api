import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { ChatBotMessage } from '../Types/ChatBotMessage'

type ChatBotMessageCreationAttributes = Optional<ChatBotMessage, 'interactive'>

class ChatBotMessageRecord
  extends Model<ChatBotMessage, ChatBotMessageCreationAttributes>
  implements ChatBotMessage
{
  public id!: string
  public name!: string
  public description!: string
  public message!: string
  public enabled!: boolean
  public interactive!: any
  public readonly created_at!: Date
  public readonly updated_at!: Date
}

ChatBotMessageRecord.init(
  {
    id: {
      type: DataTypes.STRING(120),
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    interactive: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  } as any,
  {
    sequelize,
    tableName: 'chatbot_messages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default ChatBotMessageRecord
