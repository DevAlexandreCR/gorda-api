jest.mock('../../../Helpers/Locale', () => ({
  Locale: {
    getInstance: jest.fn().mockReturnValue({
      __: (key: string) => key,
    }),
  },
}))

jest.mock('../../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      findMessageById: jest.fn().mockImplementation(() => ({
        id: 'service_assigned',
        name: 'service_assigned',
        message: 'Tu conductor llega en un movil placa [[PLATE]], color [[COLOR]]',
        enabled: true,
        description: '',
        interactive: null,
      })),
    }),
  },
}))

import { serviceAssigned, VehicleSnapshot } from '../Messages'

describe('Messages.serviceAssigned — frozen vehicle snapshot', () => {
  it('uses the plate from the frozen snapshot, not from a swapped vehicle', () => {
    const frozenSnapshot: VehicleSnapshot = {
      plate: 'ABC123',
      color: { name: 'rojo' },
    }

    const msg = serviceAssigned(frozenSnapshot)

    expect(msg.message).toContain('123')
    expect(msg.message).not.toContain('XYZ')
  })

  it('produces different message when given the swapped vehicle plate', () => {
    const swappedVehicle: VehicleSnapshot = {
      plate: 'XYZ789',
      color: { name: 'azul' },
    }

    const msg = serviceAssigned(swappedVehicle)

    expect(msg.message).toContain('789')
    expect(msg.message).not.toContain('ABC')
  })

  it('mid-shift swap: frozen snapshot plate differs from new plate and message preserves frozen plate', () => {
    const frozenPlate = 'ABC123'
    const swappedPlate = 'XYZ789'

    const frozenSnapshot: VehicleSnapshot = { plate: frozenPlate, color: { name: 'rojo' } }
    const swappedSnapshot: VehicleSnapshot = { plate: swappedPlate, color: { name: 'azul' } }

    const msgFromFrozen = serviceAssigned(frozenSnapshot)
    const msgFromSwapped = serviceAssigned(swappedSnapshot)

    // The message built from the frozen snapshot should contain the frozen plate suffix
    expect(msgFromFrozen.message).toContain('123')
    // The message built from the swapped snapshot should contain the swapped plate suffix
    expect(msgFromSwapped.message).toContain('789')
    // They must differ — proving the function reads exactly what is passed (the snapshot),
    // not some live driver state
    expect(msgFromFrozen.message).not.toBe(msgFromSwapped.message)
  })

  it('handles null color gracefully without throwing', () => {
    const snapshotWithNullColor: VehicleSnapshot = {
      plate: 'DEF456',
      color: null,
    }

    expect(() => serviceAssigned(snapshotWithNullColor)).not.toThrow()
    const msg = serviceAssigned(snapshotWithNullColor)
    expect(msg.message).toContain('456')
  })
})
