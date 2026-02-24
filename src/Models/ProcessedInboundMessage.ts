import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { ProcessedInboundMessageInterface } from '../Interfaces/ProcessedInboundMessageInterface'

type ProcessedInboundMessageCreationAttributes = Optional<
  ProcessedInboundMessageInterface,
  'id' | 'processedAt' | 'createdAt' | 'updatedAt'
>

class ProcessedInboundMessage
  extends Model<ProcessedInboundMessageInterface, ProcessedInboundMessageCreationAttributes>
  implements ProcessedInboundMessageInterface {
  public id!: number
  public wpClientId!: string
  public messageId!: string
  public provider!: string
  public readonly processedAt!: Date
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

ProcessedInboundMessage.init(
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
    messageId: {
      type: DataTypes.STRING(191),
      allowNull: false,
      field: 'message_id',
    },
    provider: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'processed_at',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  },
  {
    sequelize,
    tableName: 'processed_inbound_messages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: 'processed_inbound_messages_processed_at',
        fields: ['processed_at'],
      },
      {
        name: 'processed_inbound_messages_unique_wp_client_message',
        unique: true,
        fields: ['wp_client_id', 'message_id'],
      },
    ],
  }
)

export default ProcessedInboundMessage
