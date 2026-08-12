jest.mock('../../../../queue/QueueService', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn().mockReturnValue({
      addQueue: jest.fn(),
      addWorker: jest.fn(),
      add: jest.fn(),
    }),
  },
}))

import { BaileysClient } from '../BaileysClient'
import { WpClient } from '../../../../../Interfaces/WpClient'
import { WpClients } from '../../../constants/WPClients'

const wpClient: WpClient = {
  id: 'wp-client-1',
  alias: 'Test Client',
  wpNotifications: false,
  full: false,
  chatBot: true,
  assistant: false,
  service: WpClients.BAILEYS,
}

describe('BaileysClient.sendTypingIndicator (spec: chatbot-typing-indicator - non-Official transports are inert)', () => {
  it('resolves without sending anything on the WhatsApp connection', async () => {
    const client = new BaileysClient(wpClient)

    // The real socket is only created by initialize(); stub it here so any accidental
    // use of the connection during sendTypingIndicator would fail the assertions below.
    const clientSock = { sendMessage: jest.fn(), sendPresenceUpdate: jest.fn() }
    ;(client as any).clientSock = clientSock

    await expect(client.sendTypingIndicator('573001234567@s.whatsapp.net', 'wamid.HBgMOTI=')).resolves.toBeUndefined()

    expect(clientSock.sendMessage).not.toHaveBeenCalled()
    expect(clientSock.sendPresenceUpdate).not.toHaveBeenCalled()
  })
})
