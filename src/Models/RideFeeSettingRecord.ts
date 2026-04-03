import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'

class RideFeeSettingRecord extends Model {
  public id!: string
  public price_kilometer!: number
  public price_minute!: number
  public fees_base!: number
  public fees_additional!: number
  public fees_minimum!: number
  public fees_night!: number
  public fees_DxF!: number
  public fees_night_DxF!: number
  public fees_min_day!: number
  public fees_min_nigth!: number
  public fees_min_festive_day!: number
  public fees_min_festive_nigth!: number
  public timeout_to_complete!: number
  public timeout_to_connection!: number
  public fee_multiplier!: number
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

RideFeeSettingRecord.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
      defaultValue: 'default',
    },
    price_kilometer: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    price_minute: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_base: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_additional: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_minimum: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_night: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_DxF: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_night_DxF: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_day: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_nigth: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_festive_day: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_festive_nigth: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    timeout_to_complete: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 240,
    },
    timeout_to_connection: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 120,
    },
    fee_multiplier: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 1,
    },
    createdAt: {
      type: DataTypes.DATE,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'ride_fee_settings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default RideFeeSettingRecord
