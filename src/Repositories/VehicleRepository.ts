import { Op, QueryTypes, Transaction, WhereOptions, literal } from 'sequelize'
import sequelize from '../Database/sequelize'
import VehicleRecord from '../Models/VehicleRecord'
import { VehicleRecordInterface } from '../Interfaces/VehicleRecordInterface'
import { normalizePlate } from '../Helpers/PlateHelper'

export function getMissingVehicleFields(v: Partial<VehicleRecordInterface>): string[] {
  const missing: string[] = []
  if (!v.brand || typeof v.brand !== 'string' || v.brand.trim() === '') missing.push('brand')
  if (!v.model || typeof v.model !== 'string' || v.model.trim() === '') missing.push('model')
  if (!v.color || typeof v.color.name !== 'string' || v.color.name.trim() === '')
    missing.push('color')
  if (v.soat_exp == null) missing.push('soat_exp')
  if (v.tec_exp == null) missing.push('tec_exp')
  return missing
}

export function isVehicleComplete(v: Partial<VehicleRecordInterface>): boolean {
  return getMissingVehicleFields(v).length === 0
}

export interface VehicleSearchQuery {
  search?: string
  enabled?: boolean
  sort?: string
  page?: number
  perPage?: number
}

export interface LinkedDriver {
  driver_id: string
  driver_name: string
  selectable: boolean
}

export type VehicleWithLinkedDrivers = VehicleRecordInterface & {
  linked_drivers: LinkedDriver[]
}

const SORT_WHITELIST = ['plate', 'brand', 'created_at']

class VehicleRepository {
  async findByNormalizedPlate(plate: string): Promise<VehicleRecordInterface | null> {
    const record = await VehicleRecord.findOne({ where: { plate: normalizePlate(plate) } })
    return record ? this.mapVehicle(record) : null
  }

  async findOrCreateByPlate(
    plate: string,
    fullPayload: Partial<VehicleRecordInterface>,
    txn?: Transaction
  ): Promise<VehicleRecordInterface> {
    const normalizedPlate = normalizePlate(plate)
    // SELECT ... FOR UPDATE to prevent concurrent inserts
    const [rows] = await sequelize.query(`SELECT * FROM vehicles WHERE plate = :plate FOR UPDATE`, {
      replacements: { plate: normalizedPlate },
      type: QueryTypes.SELECT,
      transaction: txn,
    })
    if (rows) {
      return rows as VehicleRecordInterface
    }
    const isComplete = isVehicleComplete(fullPayload)
    const created = await VehicleRecord.create(
      { ...fullPayload, plate: normalizedPlate, enabled: isComplete } as any,
      { transaction: txn }
    )
    return created.get({ plain: true }) as VehicleRecordInterface
  }

  async findById(id: string): Promise<VehicleRecordInterface | null> {
    const record = await VehicleRecord.findByPk(id)
    return record ? this.mapVehicle(record) : null
  }

  async findByIds(ids: string[]): Promise<VehicleRecordInterface[]> {
    if (ids.length === 0) return []
    const records = await VehicleRecord.findAll({ where: { id: ids } })
    return records.map((r) => this.mapVehicle(r))
  }

  async create(data: Partial<VehicleRecordInterface>): Promise<VehicleRecordInterface> {
    const record = await VehicleRecord.create(data as any)
    return this.mapVehicle(record)
  }

  async update(id: string, partial: Partial<VehicleRecordInterface>): Promise<void> {
    await VehicleRecord.update(partial as any, { where: { id } })
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await VehicleRecord.update({ enabled } as any, { where: { id } })
  }

  async findWithLinkedDrivers(id: string): Promise<VehicleWithLinkedDrivers | null> {
    const rows = await sequelize.query<{
      id: string
      plate: string
      brand: string | null
      model: string | null
      color: { name: string; hex?: string } | null
      photo_url: string | null
      soat_exp: Date | null
      tec_exp: Date | null
      enabled: boolean
      created_at: Date
      updated_at: Date
      driver_id: string | null
      driver_name: string | null
      selectable: boolean | null
    }>(
      `SELECT
        v.id,
        v.plate,
        v.brand,
        v.model,
        v.color,
        v.photo_url,
        v.soat_exp,
        v.tec_exp,
        v.enabled,
        v.created_at,
        v.updated_at,
        dv.driver_id,
        dr.name AS driver_name,
        dv.selectable
      FROM vehicles v
      LEFT JOIN driver_vehicles dv ON dv.vehicle_id = v.id
      LEFT JOIN drivers dr ON dr.id = dv.driver_id
      WHERE v.id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    )

    if (rows.length === 0) return null

    const first = rows[0]
    const vehicle: VehicleRecordInterface = {
      id: first.id,
      plate: first.plate,
      brand: first.brand,
      model: first.model,
      color: first.color,
      photoUrl: first.photo_url,
      soat_exp: first.soat_exp,
      tec_exp: first.tec_exp,
      enabled: first.enabled,
      created_at: first.created_at,
      updated_at: first.updated_at,
    }

    const linked_drivers: LinkedDriver[] = rows
      .filter((row) => row.driver_id !== null)
      .map((row) => ({
        driver_id: row.driver_id as string,
        driver_name: row.driver_name as string,
        selectable: Boolean(row.selectable),
      }))

    return { ...vehicle, linked_drivers }
  }

  async search(
    query: VehicleSearchQuery
  ): Promise<{ vehicles: VehicleRecordInterface[]; total: number }> {
    const page = Math.max(1, query.page ?? 1)
    const perPage = query.perPage ?? 30

    const sortRaw = query.sort ?? 'plate'
    const descending = sortRaw.startsWith('-')
    const sortField = descending ? sortRaw.slice(1) : sortRaw
    if (!SORT_WHITELIST.includes(sortField)) {
      throw new Error(`Invalid sort field: "${sortField}". Allowed: ${SORT_WHITELIST.join(', ')}`)
    }
    const order: any[] = [[sortField, descending ? 'DESC' : 'ASC']]

    const andWhere: WhereOptions<any>[] = []

    if (query.search) {
      const searchPattern = `%${query.search}%`
      andWhere.push({
        [Op.or]: [
          { plate: { [Op.iLike]: searchPattern } },
          { brand: { [Op.iLike]: searchPattern } },
          { model: { [Op.iLike]: searchPattern } },
        ],
      })
    }

    if (query.enabled !== undefined) {
      andWhere.push({ enabled: query.enabled })
    }

    const where: WhereOptions<any> = andWhere.length > 0 ? { [Op.and]: andWhere } : {}

    const linkedDriversCountSubquery = literal(
      `(SELECT COUNT(dv.id) FROM driver_vehicles dv WHERE dv.vehicle_id = "VehicleRecord"."id")`
    )

    const { count, rows } = await VehicleRecord.findAndCountAll({
      where,
      order,
      limit: perPage,
      offset: (page - 1) * perPage,
      attributes: {
        include: [[linkedDriversCountSubquery, 'linked_drivers_count']],
      },
    })

    return {
      vehicles: rows.map((r) => this.mapVehicle(r)),
      total: count,
    }
  }

  private mapVehicle(record: VehicleRecord): VehicleRecordInterface {
    const plain = record.get({ plain: true }) as any
    const mapped: VehicleRecordInterface = {
      id: plain.id,
      plate: plain.plate,
      brand: plain.brand ?? null,
      model: plain.model ?? null,
      color: plain.color ?? null,
      photoUrl: plain.photoUrl ?? null,
      soat_exp: plain.soat_exp ?? null,
      tec_exp: plain.tec_exp ?? null,
      enabled: Boolean(plain.enabled),
      created_at: plain.created_at,
      updated_at: plain.updated_at,
    }
    if (plain.linked_drivers_count !== undefined) {
      mapped.linked_drivers_count = Number(plain.linked_drivers_count)
    }
    return mapped
  }
}

export default VehicleRepository
