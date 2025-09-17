import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import Branch from './Branch'

interface CityAttributes {
  id: string
  name: string
  center: any // PostGIS geometry
  percentage: number
  polygon: any // PostGIS geometry (optional)
  branchId: string
  createdAt?: Date
  updatedAt?: Date
}

interface CityCreationAttributes
  extends Optional<CityAttributes, 'polygon' | 'createdAt' | 'updatedAt'> {}

class City extends Model<CityAttributes, CityCreationAttributes> implements CityAttributes {
  public id!: string
  public name!: string
  public center!: any
  public percentage!: number
  public polygon!: any
  public branchId!: string
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

City.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    center: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
    },
    percentage: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    polygon: {
      type: DataTypes.GEOMETRY('POLYGON', 4326),
      allowNull: true,
    },
    branchId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'branch_id',
      references: {
        model: Branch,
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
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
    tableName: 'cities',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['center'],
        using: 'gist',
      },
      {
        fields: ['polygon'],
        using: 'gist',
      },
    ],
  }
)

City.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' })
Branch.hasMany(City, { foreignKey: 'branchId', as: 'cities' })

export default City
