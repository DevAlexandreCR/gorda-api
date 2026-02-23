import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.addColumn('ignored_inbound_messages_audit', 'raw_timestamp', {
    type: DataTypes.STRING(64),
    allowNull: true,
  })

  await queryInterface.addColumn('ignored_inbound_messages_audit', 'message_type', {
    type: DataTypes.STRING(32),
    allowNull: true,
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('ignored_inbound_messages_audit', 'message_type')
  await queryInterface.removeColumn('ignored_inbound_messages_audit', 'raw_timestamp')
}
