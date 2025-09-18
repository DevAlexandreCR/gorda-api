'use strict'

const { QueryTypes } = require('sequelize')

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;', { type: QueryTypes.RAW })

    await queryInterface.createTable('places', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      lat: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      lng: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      location: {
        type: Sequelize.GEOMETRY('POINT', 4326),
        allowNull: false,
      },
      city_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'cities',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
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
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('places')
  },
}
