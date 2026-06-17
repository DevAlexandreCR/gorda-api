import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'

class MonthlyPaymentSettingRecord extends Model {
  public id!: string
  public suggested_amount!: number
  public auto_disable!: boolean
  public cutoff_day!: number
  public reminder_offsets!: number[]
  public readonly updated_at!: Date
}

MonthlyPaymentSettingRecord.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
      defaultValue: 'default',
    },
    suggested_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    auto_disable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    cutoff_day: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 4,
    },
    reminder_offsets: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [3, 1],
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'driver_monthly_payment_settings',
    timestamps: false,
  }
)

export default MonthlyPaymentSettingRecord
