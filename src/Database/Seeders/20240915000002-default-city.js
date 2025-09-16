'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('cities', [
      {
        id: 'SAN_JOSE_001',
        name: 'San José',
        center: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.0907246 9.9325427)', 4326),
        percentage: 15.0,
        polygon: queryInterface.sequelize.fn('ST_GeomFromText',
          'POLYGON((-84.15 9.85, -84.15 10.05, -84.05 10.05, -84.05 9.85, -84.15 9.85))', 4326),
        branch_id: 'CR001',
        created_at: new Date(),
        updated_at: new Date()
      }
    ], {})
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('cities', {
      id: 'SAN_JOSE_001'
    }, {})
  }
}
