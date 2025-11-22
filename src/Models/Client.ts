import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { ClientInterface } from '../Interfaces/ClientInterface'

type ClientCreationAttributes = Optional<ClientInterface, 'photoUrl' | 'createdAt' | 'updatedAt'>

class Client
  extends Model<ClientInterface, ClientCreationAttributes>
  implements ClientInterface
{
  public id!: string
  public name!: string
  public phone!: string
  public photoUrl!: string
  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

Client.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    photoUrl: {
      type: DataTypes.STRING(1024),
      allowNull: false,
      field: 'photo_url',
      defaultValue: '',
    },
    createdAt: {
      type: DataTypes.DATE,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'clients',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['phone'],
        unique: true,
      },
    ],
  }
)

export default Client
