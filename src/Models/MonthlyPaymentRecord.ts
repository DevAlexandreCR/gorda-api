import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { MonthlyPaymentInterface } from '../Interfaces/MonthlyPaymentInterface'

type MonthlyPaymentAttributes = MonthlyPaymentInterface

type MonthlyPaymentCreationAttributes = Optional<
  MonthlyPaymentAttributes,
  'note' | 'created_at' | 'status' | 'voidedAt' | 'voidedByUid' | 'voidedByName' | 'voidReason'
>

class MonthlyPaymentRecord
  extends Model<MonthlyPaymentAttributes, MonthlyPaymentCreationAttributes>
  implements MonthlyPaymentAttributes
{
  public id!: string
  public driverId!: string
  public period!: string
  public amount!: number
  public createdByUid!: string
  public createdByName!: string
  public note!: string | null
  public created_at!: number
  public status!: string
  public voidedAt!: number | null
  public voidedByUid!: string | null
  public voidedByName!: string | null
  public voidReason!: string | null
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
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    voidedAt: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: null,
      field: 'voided_at',
    },
    voidedByUid: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null,
      field: 'voided_by_uid',
    },
    voidedByName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null,
      field: 'voided_by_name',
    },
    voidReason: {
      type: DataTypes.STRING(1024),
      allowNull: true,
      defaultValue: null,
      field: 'void_reason',
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
