import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { ServiceMetricDailyInterface } from '../Interfaces/ServiceMetricDailyInterface'

type ServiceMetricDailyCreationAttributes = Optional<
  ServiceMetricDailyInterface,
  'commission_sum' | 'created_at' | 'updated_at'
>

class ServiceMetricDailyRecord
  extends Model<ServiceMetricDailyInterface, ServiceMetricDailyCreationAttributes>
  implements ServiceMetricDailyInterface
{
  public date!: string
  public status!: string
  public count!: number
  public commission_sum!: number
  public readonly created_at!: Date
  public readonly updated_at!: Date
}

ServiceMetricDailyRecord.init(
  {
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      primaryKey: true,
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      primaryKey: true,
    },
    count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    commission_sum: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  } as any,
  {
    sequelize,
    tableName: 'service_metrics_daily',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['date', 'status'],
        name: 'service_metrics_daily_unique_date_status',
      },
    ],
  }
)

export default ServiceMetricDailyRecord
