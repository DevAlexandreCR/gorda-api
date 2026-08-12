import { WWebClient } from '../WWebClient'
import { WpClient } from '../../../../../Interfaces/WpClient'
import { WpClients } from '../../../constants/WPClients'

const wpClient: WpClient = {
  id: 'wp-client-1',
  alias: 'Test Client',
  wpNotifications: false,
  full: false,
  chatBot: true,
  assistant: false,
  service: WpClients.WHATSAPP_WEB_JS,
}

describe('WWebClient.sendTypingIndicator (spec: chatbot-typing-indicator - non-Official transports are inert)', () => {
  it('resolves without sending anything on the WhatsApp connection', async () => {
    const client = new WWebClient(wpClient)

    // The real puppeteer-backed client is only wired up by initialize(); stub it here so
    // any accidental use of the connection during sendTypingIndicator would fail below.
    const underlyingClient = { sendMessage: jest.fn(), sendSeen: jest.fn() }
    ;(client as any).client = underlyingClient

    await expect(
      client.sendTypingIndicator('573001234567@c.us', 'wamid.HBgMOTI=')
    ).resolves.toBeUndefined()

    expect(underlyingClient.sendMessage).not.toHaveBeenCalled()
    expect(underlyingClient.sendSeen).not.toHaveBeenCalled()
  })
})
