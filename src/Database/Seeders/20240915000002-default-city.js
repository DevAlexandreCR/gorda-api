'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('cities', [
      {
        id: 'popayan',
        name: 'Popayán',
        center: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6063 2.4448)', 4326),
        percentage: 15.0,
        polygon: queryInterface.sequelize.fn('ST_GeomFromText',
          'POLYGON((-76.65 2.40, -76.65 2.49, -76.56 2.49, -76.56 2.40, -76.65 2.40))', 4326),
        branch_id: 'colombia',
        created_at: new Date(),
        updated_at: new Date()
      }
    ], {})
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('cities', {
      id: 'popayan'
    }, {})
  }
}
