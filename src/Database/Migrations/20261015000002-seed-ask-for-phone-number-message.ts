import { QueryInterface } from 'sequelize'

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(`
    INSERT INTO chatbot_messages (id, name, description, message, enabled, interactive, created_at, updated_at)
    VALUES (
      'ASK_FOR_PHONE_NUMBER',
      'Solicitar número de teléfono',
      'Enviado cuando un cliente escribe desde un nombre de usuario de WhatsApp sin número de teléfono conocido; acompaña el botón request_contact_info.',
      'Para continuar, necesitamos tu número de teléfono. Por favor compártelo tocando el botón de abajo.',
      true,
      null,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `)
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM chatbot_messages WHERE id = 'ASK_FOR_PHONE_NUMBER'`
  )
}
