import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('ride_fee_settings', {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
    },
    price_kilometer: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    price_minute: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_base: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_additional: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_minimum: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_night: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_DxF: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_night_DxF: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_day: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_nigth: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_festive_day: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    fees_min_festive_nigth: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    timeout_to_complete: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 240,
    },
    timeout_to_connection: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 120,
    },
    fee_multiplier: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 1,
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
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('ride_fee_settings')
}
