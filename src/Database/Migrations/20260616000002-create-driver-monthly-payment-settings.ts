import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('driver_monthly_payment_settings', {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
    },
    suggested_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    auto_disable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    cutoff_day: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 4,
    },
    reminder_offsets: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [3, 1],
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('driver_monthly_payment_settings')
}
