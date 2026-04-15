import config from '../../config'

export const VERSION_UNSUPPORTED_CODE = 'client_version_unsupported'

function parseVersionPart(value: string): number {
  const normalized = value.trim()
  if (!normalized) return 0

  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function compareVersions(current: string, minimum: string): number {
  const currentParts = current.split('.').map(parseVersionPart)
  const minimumParts = minimum.split('.').map(parseVersionPart)
  const maxLength = Math.max(currentParts.length, minimumParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const currentPart = currentParts[index] ?? 0
    const minimumPart = minimumParts[index] ?? 0

    if (currentPart > minimumPart) return 1
    if (currentPart < minimumPart) return -1
  }

  return 0
}

export function getAdminVersionPolicy() {
  return {
    minVersion: config.ADMIN_MIN_VERSION,
  }
}

export function isAdminVersionSupported(version: string): boolean {
  const normalizedVersion = version.trim()
  if (!normalizedVersion) return false

  return compareVersions(normalizedVersion, config.ADMIN_MIN_VERSION) >= 0
}
