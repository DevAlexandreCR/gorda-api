import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'

class BillingSettingRecord extends Model {
  public key!: string
  public value_cop!: number
  public readonly updated_at!: Date
}

BillingSettingRecord.init(
  {
    key: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false,
    },
    value_cop: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    updated_at: {
      type: DataTypes.DATE,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'billing_settings',
    timestamps: false,
    updatedAt: 'updated_at',
  }
)

export default BillingSettingRecord
