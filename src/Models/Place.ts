import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import City from './City'
import { PlaceInterface } from '../Interfaces/PlaceInterface'

interface PlaceCreationAttributes
  extends Optional<PlaceInterface, 'id' | 'createdAt' | 'updatedAt'> {}

class Place extends Model<PlaceInterface, PlaceCreationAttributes> implements PlaceInterface {
  public id!: string
  public name!: string
  public lat!: number
  public lng!: number
  public location!: any
  public cityId!: string
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

Place.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    lat: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    lng: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    location: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
    },
    cityId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'city_id',
      references: {
        model: City,
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
    tableName: 'places',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['location'],
        using: 'gist',
      },
    ],
  }
)

Place.belongsTo(City, { foreignKey: 'cityId', as: 'city' })
City.hasMany(Place, { foreignKey: 'cityId', as: 'places' })

export default Place
