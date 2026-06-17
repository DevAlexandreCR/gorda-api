import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('driver_monthly_payments', {
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
    period: {
      type: DataTypes.STRING(7),
      allowNull: false,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    created_by_uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    created_by_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    note: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
  })

  await queryInterface.addIndex('driver_monthly_payments', ['driver_id'], {
    name: 'driver_monthly_payments_driver_id_idx',
  })

  await queryInterface.addIndex('driver_monthly_payments', ['period'], {
    name: 'driver_monthly_payments_period_idx',
  })

  await queryInterface.addIndex('driver_monthly_payments', ['driver_id', 'period'], {
    name: 'driver_monthly_payments_driver_id_period_idx',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('driver_monthly_payments')
}
