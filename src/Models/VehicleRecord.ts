import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { VehicleRecordInterface } from '../Interfaces/VehicleRecordInterface'

type VehicleCreationAttributes = Optional<
  VehicleRecordInterface,
  | 'brand'
  | 'model'
  | 'color'
  | 'photo_url'
  | 'soat_exp'
  | 'tec_exp'
  | 'enabled'
  | 'created_at'
  | 'updated_at'
>

class VehicleRecord
  extends Model<VehicleRecordInterface, VehicleCreationAttributes>
  implements VehicleRecordInterface
{
  public id!: string
  public plate!: string
  public brand!: string | null
  public model!: string | null
  public color!: { name: string; hex?: string } | null
  public photo_url!: string | null
  public soat_exp!: Date | null
  public tec_exp!: Date | null
  public enabled!: boolean
  public readonly created_at!: Date
  public readonly updated_at!: Date
}

VehicleRecord.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    plate: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    brand: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },
    color: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
    },
    photo_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      field: 'photo_url',
    },
    soat_exp: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      field: 'soat_exp',
    },
    tec_exp: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      field: 'tec_exp',
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  } as any,
  {
    sequelize,
    tableName: 'vehicles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default VehicleRecord
