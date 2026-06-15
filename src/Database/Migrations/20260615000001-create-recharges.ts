import { DataTypes, QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('recharges', {
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
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    balance_before: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    balance_after: {
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

  await queryInterface.addIndex('recharges', ['driver_id'], {
    name: 'recharges_driver_id_idx',
  })

  await queryInterface.addIndex('recharges', ['created_at'], {
    name: 'recharges_created_at_idx',
  })
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('recharges')
}
