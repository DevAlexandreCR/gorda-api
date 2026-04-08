import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.addColumn('service_history', 'created_by', {
    type: DataTypes.STRING(128),
    allowNull: true,
  })

  await queryInterface.addColumn('service_history', 'assigned_by', {
    type: DataTypes.STRING(128),
    allowNull: true,
  })

  await queryInterface.addColumn('service_history', 'canceled_by', {
    type: DataTypes.STRING(128),
    allowNull: true,
  })

  await queryInterface.addColumn('service_history', 'terminated_by', {
    type: DataTypes.STRING(128),
    allowNull: true,
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('service_history', 'terminated_by')
  await queryInterface.removeColumn('service_history', 'canceled_by')
  await queryInterface.removeColumn('service_history', 'assigned_by')
  await queryInterface.removeColumn('service_history', 'created_by')
}
