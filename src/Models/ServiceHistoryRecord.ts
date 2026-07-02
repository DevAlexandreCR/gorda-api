import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { ServiceInterface } from '../Interfaces/ServiceInterface'

type ServiceHistoryCreationAttributes = Optional<
  ServiceInterface,
  | 'comment'
  | 'amount'
  | 'driver_id'
  | 'end_loc'
  | 'wp_client_id'
  | 'created_by'
  | 'assigned_by'
  | 'canceled_by'
  | 'terminated_by'
>

class ServiceHistoryRecord
  extends Model<ServiceInterface, ServiceHistoryCreationAttributes>
  implements ServiceInterface
{
  public id!: string
  public status!: string
  public start_loc!: ServiceInterface['start_loc']
  public end_loc!: ServiceInterface['end_loc']
  public phone!: string
  public name!: string
  public comment!: string | null
  public amount!: number | null
  public metadata!: ServiceInterface['metadata']
  public driver_id!: string | null
  public client_id!: string
  public wp_client_id!: string | null
  public created_at!: number
  public created_by!: string | null
  public assigned_by!: string | null
  public canceled_by!: string | null
  public terminated_by!: string | null
  public vehicle_id!: string | null
  public deducted_value!: number
  public readonly updated_at!: Date
}

ServiceHistoryRecord.init(
  {
    id: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    start_loc: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    end_loc: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: null,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    driver_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    client_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    wp_client_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    created_by: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    assigned_by: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    canceled_by: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    terminated_by: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    vehicle_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    deducted_value: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  } as any,
  {
    sequelize,
    tableName: 'service_history',
    timestamps: true,
    createdAt: false,
    updatedAt: 'updated_at',
  }
)

export default ServiceHistoryRecord
