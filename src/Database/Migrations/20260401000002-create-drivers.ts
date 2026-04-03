import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('drivers', {
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
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    phone2: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    doc_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    payment_mode: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'monthly',
    },
    document: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    photo_url: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    vehicle: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    device: {
      type: DataTypes.JSONB,
      allowNull: true,
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
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('drivers')
}
