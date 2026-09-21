import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `UPDATE wp_clients SET service = 'baileys' WHERE service = 'whatsapp-web-js'`
  )
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `UPDATE wp_clients SET service = 'whatsapp-web-js' WHERE service = 'baileys'`
  )
}
