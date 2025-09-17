'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert(
      'branches',
      [
        {
          id: 'colombia',
          country: 'Colombia',
          calling_code: '+57',
          currency_code: 'COP',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      {}
    )
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete(
      'branches',
      {
        id: 'CO001',
      },
      {}
    )
  },
}
