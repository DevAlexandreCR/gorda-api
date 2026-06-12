import ActiveVehicleAssignmentRecord from '../Models/ActiveVehicleAssignmentRecord'

export interface ActiveVehicleAssignment {
  vehicle_id: string
  driver_id: string
  session_id: string | null
  acquired_at: Date
}

class ActiveVehicleAssignmentRepository {
  async acquire(driverId: string, vehicleId: string, sessionId: string | null): Promise<void> {
    await ActiveVehicleAssignmentRecord.create({
      vehicle_id: vehicleId,
      driver_id: driverId,
      session_id: sessionId,
    })
  }

  async releaseByDriver(driverId: string): Promise<void> {
    await ActiveVehicleAssignmentRecord.destroy({ where: { driver_id: driverId } })
  }

  async releaseByVehicle(vehicleId: string): Promise<void> {
    await ActiveVehicleAssignmentRecord.destroy({ where: { vehicle_id: vehicleId } })
  }

  async findByDriver(driverId: string): Promise<ActiveVehicleAssignment | null> {
    const record = await ActiveVehicleAssignmentRecord.findOne({ where: { driver_id: driverId } })
    if (!record) return null
    return this.mapRecord(record)
  }

  async findByVehicle(vehicleId: string): Promise<ActiveVehicleAssignment | null> {
    const record = await ActiveVehicleAssignmentRecord.findByPk(vehicleId)
    if (!record) return null
    return this.mapRecord(record)
  }

  private mapRecord(record: ActiveVehicleAssignmentRecord): ActiveVehicleAssignment {
    const plain = record.get({ plain: true }) as any
    return {
      vehicle_id: plain.vehicle_id,
      driver_id: plain.driver_id,
      session_id: plain.session_id ?? null,
      acquired_at: plain.acquired_at,
    }
  }
}

export default new ActiveVehicleAssignmentRepository()
