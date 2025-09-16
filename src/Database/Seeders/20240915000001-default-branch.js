'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('branches', [
      {
        id: 'CR001',
        country: 'Costa Rica',
        calling_code: '+506',
        currency_code: 'CRC',
        created_at: new Date(),
        updated_at: new Date()
      }
    ], {})
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('branches', {
      id: 'CR001'
    }, {})
  }
}
