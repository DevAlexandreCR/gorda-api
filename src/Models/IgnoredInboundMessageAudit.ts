import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import {
  IgnoredInboundMessageAuditInterface,
  IgnoredInboundMessageReason,
} from '../Interfaces/IgnoredInboundMessageAuditInterface'

type IgnoredInboundMessageCreationAttributes = Optional<
  IgnoredInboundMessageAuditInterface,
  | 'id'
  | 'chatId'
  | 'rawTimestamp'
  | 'messageType'
  | 'messageAgeMinutes'
  | 'messageTimestamp'
  | 'receivedAt'
  | 'createdAt'
  | 'updatedAt'
>

class IgnoredInboundMessageAudit
  extends Model<IgnoredInboundMessageAuditInterface, IgnoredInboundMessageCreationAttributes>
  implements IgnoredInboundMessageAuditInterface
{
  public id!: number
  public wpClientId!: string
  public provider!: string
  public messageId!: string
  public chatId!: string | null
  public rawTimestamp!: string | null
  public messageType!: string | null
  public reason!: IgnoredInboundMessageReason
  public messageAgeMinutes!: number | null
  public messageTimestamp!: number | null
  public readonly receivedAt!: Date
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

IgnoredInboundMessageAudit.init(
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
    provider: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    messageId: {
      type: DataTypes.STRING(191),
      allowNull: false,
      field: 'message_id',
    },
    chatId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'chat_id',
    },
    rawTimestamp: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'raw_timestamp',
    },
    messageType: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: 'message_type',
    },
    reason: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    messageAgeMinutes: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: 'message_age_minutes',
    },
    messageTimestamp: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'message_timestamp',
    },
    receivedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'received_at',
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
    tableName: 'ignored_inbound_messages_audit',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { name: 'ignored_inbound_messages_audit_received_at', fields: ['received_at'] },
      {
        name: 'ignored_inbound_messages_audit_wp_client_id_received_at',
        fields: ['wp_client_id', 'received_at'],
      },
      {
        name: 'ignored_inbound_messages_audit_provider_received_at',
        fields: ['provider', 'received_at'],
      },
      {
        name: 'ignored_inbound_messages_audit_unique_message_reason',
        unique: true,
        fields: ['wp_client_id', 'provider', 'message_id', 'reason'],
      },
    ],
  }
)

export default IgnoredInboundMessageAudit
