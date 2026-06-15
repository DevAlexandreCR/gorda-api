import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('driver_vehicles', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    driver_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
      references: {
        model: 'drivers',
        key: 'id',
      },
    },
    vehicle_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehicles',
        key: 'id',
      },
    },
    selectable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    added_at: {
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

  await queryInterface.addIndex('driver_vehicles', ['driver_id', 'vehicle_id'], {
    unique: true,
    name: 'driver_vehicles_driver_id_vehicle_id_unique',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('driver_vehicles')
}
