import { ClientFactory } from '../ClientFactory'
import { WpClient } from '../../../Interfaces/WpClient'
import { WpClients } from '../constants/WPClients'

const baseWpClient: WpClient = {
  id: 'client-1',
  alias: 'Test client',
  wpNotifications: false,
  full: false,
  chatBot: false,
  assistant: false,
  agentInTrip: false,
  service: WpClients.BAILEYS,
}

describe('ClientFactory.build (spec: wp-baileys-transport - Supported transports)', () => {
  it('throws for an unknown/retired transport value such as whatsapp-web-js', () => {
    const wpClient = {
      ...baseWpClient,
      service: 'whatsapp-web-js' as unknown as WpClients,
    }

    expect(() => ClientFactory.build(wpClient)).toThrow(
      'Unsupported WhatsApp transport: whatsapp-web-js'
    )
  })
})
