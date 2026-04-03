import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'
import RideFeeSettingRecord from './RideFeeSettingRecord'

class RideFeeDynamicMultiplierRecord extends Model {
  public id!: number
  public setting_id!: string
  public name!: string
  public multiplier!: number
  public start_time!: string
  public end_time!: string
  public position!: number
}

RideFeeDynamicMultiplierRecord.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    setting_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      references: {
        model: RideFeeSettingRecord,
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    multiplier: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 1,
    },
    start_time: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    end_time: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'ride_fee_dynamic_multipliers',
    timestamps: false,
  }
)

RideFeeDynamicMultiplierRecord.belongsTo(RideFeeSettingRecord, {
  foreignKey: 'setting_id',
  as: 'setting',
})
RideFeeSettingRecord.hasMany(RideFeeDynamicMultiplierRecord, {
  foreignKey: 'setting_id',
  as: 'dynamicMultipliers',
})

export default RideFeeDynamicMultiplierRecord
