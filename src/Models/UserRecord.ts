import { DataTypes, Model, Optional } from 'sequelize'
import sequelize from '../Database/sequelize'
import { UserInterface, UserRoles } from '../Interfaces/UserInterface'

type UserCreationAttributes = Optional<
  UserInterface,
  'password' | 'photoUrl' | 'enabled_at' | 'created_at' | 'roles'
>

class UserRecord
  extends Model<UserInterface, UserCreationAttributes>
  implements UserInterface
{
  public id!: string
  public name!: string
  public email!: string
  public password!: string | null
  public phone!: string
  public photoUrl!: string | null
  public enabled_at!: number
  public created_at!: number
  public roles!: UserRoles
  public readonly updated_at!: Date
}

UserRecord.init(
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
    photoUrl: {
      type: DataTypes.STRING(1024),
      allowNull: true,
      field: 'photo_url',
      defaultValue: null,
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
    roles: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {
        operator: false,
        admin: false,
      },
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  } as any,
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
    createdAt: false,
    updatedAt: 'updated_at',
  }
)

export default UserRecord
