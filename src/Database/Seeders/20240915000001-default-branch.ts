import { QueryInterface, DataTypes } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface, Sequelize: typeof DataTypes): Promise<void> {
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

  async down(queryInterface: QueryInterface, Sequelize: typeof DataTypes): Promise<void> {
    await queryInterface.bulkDelete(
      'branches',
      {
        id: 'CO001',
      },
      {}
    )
  },
}
