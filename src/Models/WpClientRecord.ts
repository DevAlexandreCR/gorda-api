import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { WpClient } from '../Interfaces/WpClient'
import { WpClients } from '../Services/whatsapp/constants/WPClients'

type WpClientCreationAttributes = Optional<
  WpClient,
  'full' | 'wpNotifications' | 'chatBot' | 'assistant'
>

class WpClientRecord
  extends Model<WpClient, WpClientCreationAttributes>
  implements WpClient
{
  public id!: string
  public alias!: string
  public wpNotifications!: boolean
  public full!: boolean
  public chatBot!: boolean
  public assistant!: boolean
  public service!: WpClients
  public readonly created_at!: Date
  public readonly updated_at!: Date
}

WpClientRecord.init(
  {
    id: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    alias: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    wpNotifications: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'wp_notifications',
      defaultValue: false,
    },
    full: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    chatBot: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'chat_bot',
      defaultValue: false,
    },
    assistant: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    service: {
      type: DataTypes.STRING(50),
      allowNull: false,
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
    tableName: 'wp_clients',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default WpClientRecord
