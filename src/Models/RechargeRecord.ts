import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { RechargeInterface } from '../Interfaces/RechargeInterface'

type RechargeCreationAttributes = Optional<RechargeInterface, 'note' | 'created_at'>

class RechargeRecord
  extends Model<RechargeInterface, RechargeCreationAttributes>
  implements RechargeInterface
{
  public id!: string
  public driverId!: string
  public amount!: number
  public balanceBefore!: number
  public balanceAfter!: number
  public createdByUid!: string
  public createdByName!: string
  public note!: string | null
  public created_at!: number
}

RechargeRecord.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    driverId: {
      type: DataTypes.STRING(128),
      allowNull: false,
      field: 'driver_id',
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    balanceBefore: {
      type: DataTypes.FLOAT,
      allowNull: false,
      field: 'balance_before',
    },
    balanceAfter: {
      type: DataTypes.FLOAT,
      allowNull: false,
      field: 'balance_after',
    },
    createdByUid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'created_by_uid',
    },
    createdByName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'created_by_name',
    },
    note: {
      type: DataTypes.STRING(1024),
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
  } as any,
  {
    sequelize,
    tableName: 'recharges',
    timestamps: false,
  }
)

export function setupRechargeAssociations(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: DriverRecord } = require('./DriverRecord')

  RechargeRecord.belongsTo(DriverRecord, { foreignKey: 'driver_id', as: 'driver' })
  DriverRecord.hasMany(RechargeRecord, { foreignKey: 'driver_id', as: 'recharges' })
}

export default RechargeRecord
