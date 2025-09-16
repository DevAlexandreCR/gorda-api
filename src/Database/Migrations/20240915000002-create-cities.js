'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Enable PostGIS extension if not already enabled
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;')

    await queryInterface.createTable('cities', {
      id: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      center: {
        type: Sequelize.GEOMETRY('POINT', 4326),
        allowNull: false
      },
      percentage: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      polygon: {
        type: Sequelize.GEOMETRY('POLYGON', 4326),
        allowNull: true
      },
      branch_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'branches',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    })

    // Create spatial indexes
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS cities_center_idx ON cities USING GIST (center);')
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS cities_polygon_idx ON cities USING GIST (polygon);')
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('cities')
  }
}
