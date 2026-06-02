import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'

class BillingLineChargeRecord extends Model {
  public wp_client_id!: string
  public amount_cop!: number
  public readonly created_at!: Date
  public readonly updated_at!: Date
}

BillingLineChargeRecord.init(
  {
    wp_client_id: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    amount_cop: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'billing_line_charges',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default BillingLineChargeRecord
