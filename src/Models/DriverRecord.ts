import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { DriverInterface } from '../Interfaces/DriverInterface'

type DriverCreationAttributes = Optional<
  DriverInterface,
  | 'password'
  | 'phone2'
  | 'paymentMode'
  | 'photoUrl'
  | 'device'
  | 'balance'
  | 'enabled_at'
  | 'created_at'
  | 'last_connection'
>

class DriverRecord
  extends Model<DriverInterface, DriverCreationAttributes>
  implements DriverInterface
{
  public id!: string
  public name!: string
  public email!: string
  public password!: string | null
  public phone!: string
  public phone2!: string | null
  public docType!: string
  public paymentMode!: string
  public document!: string
  public photoUrl!: string | null
  public vehicle!: any
  public device!: Record<string, any> | null
  public balance!: number
  public enabled_at!: number
  public created_at!: number
  public last_connection!: number
  public selected_vehicle_id!: string | null
  public readonly updated_at!: Date
}

DriverRecord.init(
  {
    id: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null,
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    phone2: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: null,
    },
    docType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'doc_type',
    },
    paymentMode: {
      type: DataTypes.STRING(30),
      allowNull: false,
      field: 'payment_mode',
      defaultValue: 'monthly',
    },
    document: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    photoUrl: {
      type: DataTypes.STRING(1024),
      allowNull: true,
      field: 'photo_url',
      defaultValue: null,
    },
    vehicle: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    device: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
    },
    balance: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    enabled_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    last_connection: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    selected_vehicle_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  } as any,
  {
    sequelize,
    tableName: 'drivers',
    timestamps: true,
    createdAt: false,
    updatedAt: 'updated_at',
  }
)

export function setupDriverAssociations(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: VehicleRecord } = require('./VehicleRecord')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: DriverVehicleRecord } = require('./DriverVehicleRecord')

  DriverRecord.belongsTo(VehicleRecord, {
    foreignKey: 'selected_vehicle_id',
    as: 'selectedVehicle',
  })
  DriverRecord.hasMany(DriverVehicleRecord, {
    foreignKey: 'driver_id',
    as: 'driverVehicles',
  })
}

export default DriverRecord
