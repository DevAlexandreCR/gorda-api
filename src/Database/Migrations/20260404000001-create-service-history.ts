import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('service_history', {
    id: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    start_loc: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    end_loc: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    driver_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    client_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    wp_client_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  })

  await queryInterface.addIndex('service_history', ['driver_id', 'created_at'])
  await queryInterface.addIndex('service_history', ['status', 'created_at'])
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('service_history')
}
