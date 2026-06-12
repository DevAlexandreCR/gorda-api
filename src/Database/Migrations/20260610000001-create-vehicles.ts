import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('vehicles', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    plate: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    brand: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    color: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    photo_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    soat_exp: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    tec_exp: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  })

  await queryInterface.addIndex('vehicles', ['plate'], {
    unique: true,
    name: 'vehicles_plate_unique',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('vehicles')
}
