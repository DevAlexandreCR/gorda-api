import * as Sentry from '@sentry/node'
import { WpClient } from '../../Interfaces/WpClient'
import { ClientDictionary } from '../../Interfaces/ClientDiccionary'

// Kept transport-agnostic (no WhatsAppClient/ClientFactory import) so this module
// stays outside the import graph that currently fails to type-check through
// BaileysClient, and so it can be unit-tested without a real Baileys/Official client.
export interface InitializableWpService {
  setWpClient(client: WpClient): void
  initClient(): void
}

// Boot loop for store.getWpClients: creates/updates one WPClient wrapper per line.
// A single line throwing (e.g. ClientFactory.build rejecting an unknown `service`)
// must not abort initialization of the remaining lines.
export function initializeWpClients<T extends InitializableWpService>(
  clients: ClientDictionary,
  wpServices: Record<string, T>,
  createWpService: (client: WpClient) => T,
  onCreated?: (client: WpClient, wpService: T) => void
): void {
  Object.values(clients).forEach((client: WpClient) => {
    try {
      if (!wpServices[client.id]) {
        const wpService = createWpService(client)
        wpService.setWpClient(client)
        wpService.initClient()
        wpServices[client.id] = wpService
        onCreated?.(client, wpService)
      } else {
        wpServices[client.id].setWpClient(client)
      }
    } catch (error) {
      console.error('Failed to initialize WhatsApp line', { wpClientId: client.id, error })
      Sentry.captureException(error)
    }
  })
}
