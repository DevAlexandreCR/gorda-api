import { QueryInterface, DataTypes, QueryTypes } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;', { type: QueryTypes.RAW })

  await queryInterface.createTable('places', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    lat: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    lng: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    location: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
    },
    city_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      references: {
        model: 'cities',
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

  // Create spatial index
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS places_location_idx ON places USING GIST (location);'
  )
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS places_name_trgm_idx ON "places" USING GIN (name gin_trgm_ops);',
    { type: QueryTypes.RAW }
  )
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('places')
}
