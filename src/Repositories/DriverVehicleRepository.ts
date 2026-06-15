import { QueryTypes, Transaction } from 'sequelize'
import sequelize from '../Database/sequelize'
import DriverVehicleRecord from '../Models/DriverVehicleRecord'
import { VehicleRecordInterface } from '../Interfaces/VehicleRecordInterface'

export interface DriverVehicleLink {
  id: string
  driver_id: string
  vehicle_id: string
  selectable: boolean
  added_at: Date
  updated_at: Date
  vehicle: VehicleRecordInterface
}

class DriverVehicleRepository {
  async listForDriver(
    driverId: string,
    opts: { includeAll?: boolean } = {}
  ): Promise<DriverVehicleLink[]> {
    const gateClause = opts.includeAll ? '' : 'AND dv.selectable = true AND v.enabled = true'

    const rows = await sequelize.query<{
      id: string
      driver_id: string
      vehicle_id: string
      selectable: boolean
      added_at: Date
      updated_at: Date
      v_id: string
      plate: string
      brand: string | null
      model: string | null
      color: { name: string; hex?: string } | null
      photo_url: string | null
      soat_exp: Date | null
      tec_exp: Date | null
      enabled: boolean
      created_at: Date
      v_updated_at: Date
    }>(
      `SELECT
        dv.id,
        dv.driver_id,
        dv.vehicle_id,
        dv.selectable,
        dv.added_at,
        dv.updated_at,
        v.id          AS v_id,
        v.plate,
        v.brand,
        v.model,
        v.color,
        v.photo_url,
        v.soat_exp,
        v.tec_exp,
        v.enabled,
        v.created_at,
        v.updated_at  AS v_updated_at
      FROM driver_vehicles dv
      JOIN vehicles v ON v.id = dv.vehicle_id
      WHERE dv.driver_id = :driverId
      ${gateClause}
      ORDER BY dv.added_at DESC`,
      {
        replacements: { driverId },
        type: QueryTypes.SELECT,
      }
    )

    return rows.map((row) => this.mapRow(row))
  }

  async link(driverId: string, vehicleId: string, txn?: Transaction): Promise<DriverVehicleRecord> {
    return DriverVehicleRecord.create(
      {
        driver_id: driverId,
        vehicle_id: vehicleId,
        selectable: true,
      } as any,
      { transaction: txn }
    )
  }

  async setSelectable(driverId: string, vehicleId: string, selectable: boolean): Promise<void> {
    await DriverVehicleRecord.update({ selectable } as any, {
      where: { driver_id: driverId, vehicle_id: vehicleId },
    })
  }

  async findEligibleForDriver(driverId: string): Promise<DriverVehicleLink[]> {
    return this.listForDriver(driverId, { includeAll: false })
  }

  async findMostRecentEligible(driverId: string): Promise<DriverVehicleLink | null> {
    const rows = await sequelize.query<{
      id: string
      driver_id: string
      vehicle_id: string
      selectable: boolean
      added_at: Date
      updated_at: Date
      v_id: string
      plate: string
      brand: string | null
      model: string | null
      color: { name: string; hex?: string } | null
      photo_url: string | null
      soat_exp: Date | null
      tec_exp: Date | null
      enabled: boolean
      created_at: Date
      v_updated_at: Date
    }>(
      `SELECT
        dv.id,
        dv.driver_id,
        dv.vehicle_id,
        dv.selectable,
        dv.added_at,
        dv.updated_at,
        v.id          AS v_id,
        v.plate,
        v.brand,
        v.model,
        v.color,
        v.photo_url,
        v.soat_exp,
        v.tec_exp,
        v.enabled,
        v.created_at,
        v.updated_at  AS v_updated_at
      FROM driver_vehicles dv
      JOIN vehicles v ON v.id = dv.vehicle_id
      WHERE dv.driver_id = :driverId
        AND dv.selectable = true
        AND v.enabled = true
      ORDER BY dv.added_at DESC
      LIMIT 1`,
      {
        replacements: { driverId },
        type: QueryTypes.SELECT,
      }
    )

    return rows.length > 0 ? this.mapRow(rows[0]) : null
  }

  private mapRow(row: {
    id: string
    driver_id: string
    vehicle_id: string
    selectable: boolean
    added_at: Date
    updated_at: Date
    v_id: string
    plate: string
    brand: string | null
    model: string | null
    color: { name: string; hex?: string } | null
    photo_url: string | null
    soat_exp: Date | null
    tec_exp: Date | null
    enabled: boolean
    created_at: Date
    v_updated_at: Date
  }): DriverVehicleLink {
    return {
      id: row.id,
      driver_id: row.driver_id,
      vehicle_id: row.vehicle_id,
      selectable: Boolean(row.selectable),
      added_at: row.added_at,
      updated_at: row.updated_at,
      vehicle: {
        id: row.v_id,
        plate: row.plate,
        brand: row.brand ?? null,
        model: row.model ?? null,
        color: row.color ?? null,
        photoUrl: row.photo_url ?? null,
        soat_exp: row.soat_exp ?? null,
        tec_exp: row.tec_exp ?? null,
        enabled: Boolean(row.enabled),
        created_at: row.created_at,
        updated_at: row.v_updated_at,
      },
    }
  }
}

export default DriverVehicleRepository
