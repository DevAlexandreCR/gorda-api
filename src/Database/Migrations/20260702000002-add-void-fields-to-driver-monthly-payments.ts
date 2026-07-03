import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.addColumn('driver_monthly_payments', 'status', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'active',
  })

  await queryInterface.addColumn('driver_monthly_payments', 'voided_at', {
    type: DataTypes.BIGINT,
    allowNull: true,
  })

  await queryInterface.addColumn('driver_monthly_payments', 'voided_by_uid', {
    type: DataTypes.STRING(255),
    allowNull: true,
  })

  await queryInterface.addColumn('driver_monthly_payments', 'voided_by_name', {
    type: DataTypes.STRING(255),
    allowNull: true,
  })

  await queryInterface.addColumn('driver_monthly_payments', 'void_reason', {
    type: DataTypes.STRING(1024),
    allowNull: true,
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('driver_monthly_payments', 'void_reason')
  await queryInterface.removeColumn('driver_monthly_payments', 'voided_by_name')
  await queryInterface.removeColumn('driver_monthly_payments', 'voided_by_uid')
  await queryInterface.removeColumn('driver_monthly_payments', 'voided_at')
  await queryInterface.removeColumn('driver_monthly_payments', 'status')
}
