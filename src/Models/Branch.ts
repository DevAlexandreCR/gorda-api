import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'

interface BranchAttributes {
  id: string
  country: string
  callingCode: string
  currencyCode: string
  createdAt?: Date
  updatedAt?: Date
}

interface BranchCreationAttributes extends Optional<BranchAttributes, 'createdAt' | 'updatedAt'> {}

class Branch extends Model<BranchAttributes, BranchCreationAttributes> implements BranchAttributes {
  public id!: string
  public country!: string
  public callingCode!: string
  public currencyCode!: string
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

Branch.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    callingCode: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: 'calling_code',
    },
    currencyCode: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: 'currency_code',
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  },
  {
    sequelize,
    tableName: 'branches',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
)

export default Branch
