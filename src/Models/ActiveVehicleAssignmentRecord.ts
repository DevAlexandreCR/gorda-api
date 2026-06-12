import { DataTypes, Model } from 'sequelize'
import sequelize from '../Database/sequelize'

class ActiveVehicleAssignmentRecord extends Model {
  public vehicle_id!: string
  public driver_id!: string
  public session_id!: string | null
  public readonly acquired_at!: Date
}

ActiveVehicleAssignmentRecord.init(
  {
    vehicle_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
    },
    driver_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    session_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },
    acquired_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'acquired_at',
    },
  },
  {
    sequelize,
    tableName: 'active_vehicle_assignments',
    timestamps: false,
  }
)

export default ActiveVehicleAssignmentRecord
