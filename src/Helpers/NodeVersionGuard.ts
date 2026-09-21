import { compareVersions } from './VersionPolicy'

/**
 * Minimum Node.js version required to `require()` the ESM-only
 * @whiskeysockets/baileys package without flags (see design D1 of the
 * harden-baileys-test-line change).
 */
export const NODE_VERSION_FLOOR = '20.19.0'

export function isNodeVersionSupported(nodeVersion: string = process.versions.node): boolean {
  return compareVersions(nodeVersion, NODE_VERSION_FLOOR) >= 0
}

/**
 * Fails fast at boot when the running Node.js version cannot load the
 * Baileys WhatsApp transport. Must run before any WhatsAppClient is built.
 */
export function assertNodeVersionFloor(nodeVersion: string = process.versions.node): void {
  if (isNodeVersionSupported(nodeVersion)) return

  console.error(
    `Unsupported Node.js version: ${nodeVersion}. This API requires Node.js >= ${NODE_VERSION_FLOOR} ` +
      'to load the Baileys WhatsApp transport.'
  )
  process.exit(1)
}
