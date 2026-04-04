import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { DriverTokenInterface } from '../Interfaces/DriverTokenInterface'

type DriverTokenCreationAttributes = Optional<DriverTokenInterface, 'created_at' | 'updated_at'>

class DriverTokenRecord
  extends Model<DriverTokenInterface, DriverTokenCreationAttributes>
  implements DriverTokenInterface
{
  public driver_id!: string
  public token!: string
  public readonly created_at!: Date
  public readonly updated_at!: Date
}

DriverTokenRecord.init(
  {
    driver_id: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    token: {
      type: DataTypes.STRING(4096),
      allowNull: false,
      unique: true,
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
    tableName: 'driver_tokens',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default DriverTokenRecord
