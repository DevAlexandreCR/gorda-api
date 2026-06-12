import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'

class DriverVehicleRecord extends Model {
  public id!: string
  public driver_id!: string
  public vehicle_id!: string
  public selectable!: boolean
  public readonly added_at!: Date
  public readonly updated_at!: Date
}

DriverVehicleRecord.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    driver_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    vehicle_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    selectable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    added_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'added_at',
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'driver_vehicles',
    timestamps: true,
    createdAt: 'added_at',
    updatedAt: 'updated_at',
  }
)

export default DriverVehicleRecord
