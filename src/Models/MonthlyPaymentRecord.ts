import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { MonthlyPaymentInterface } from '../Interfaces/MonthlyPaymentInterface'

type MonthlyPaymentCreationAttributes = Optional<MonthlyPaymentInterface, 'note' | 'created_at'>

class MonthlyPaymentRecord
  extends Model<MonthlyPaymentInterface, MonthlyPaymentCreationAttributes>
  implements MonthlyPaymentInterface
{
  public id!: string
  public driverId!: string
  public period!: string
  public amount!: number
  public createdByUid!: string
  public createdByName!: string
  public note!: string | null
  public created_at!: number
}

MonthlyPaymentRecord.init(
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
    period: {
      type: DataTypes.STRING(7),
      allowNull: false,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
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
    tableName: 'driver_monthly_payments',
    timestamps: false,
  }
)

export function setupMonthlyPaymentAssociations(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: DriverRecord } = require('./DriverRecord')

  MonthlyPaymentRecord.belongsTo(DriverRecord, { foreignKey: 'driver_id', as: 'driver' })
  DriverRecord.hasMany(MonthlyPaymentRecord, { foreignKey: 'driver_id', as: 'monthlyPayments' })
}

export default MonthlyPaymentRecord
