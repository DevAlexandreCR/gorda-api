import { QueryInterface, DataTypes } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  // Enable PostGIS extension if not already enabled
  await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;')

  await queryInterface.createTable('cities', {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    center: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
    },
    percentage: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    polygon: {
      type: DataTypes.GEOMETRY('POLYGON', 4326),
      allowNull: true,
    },
    branch_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      references: {
        model: 'branches',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
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

  // Create spatial indexes
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS cities_center_idx ON cities USING GIST (center);'
  )
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS cities_polygon_idx ON cities USING GIST (polygon);'
  )
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('cities')
}
