import { Op, literal, WhereOptions } from 'sequelize'
import DriverRecord from '../Models/DriverRecord'
import { DriverInterface } from '../Interfaces/DriverInterface'
import Driver from '../Models/Driver'
import { buildDriverAvailability } from '../Services/drivers/DriverAvailability'

export interface DriverListQuery {
  search?: string
  status?: string
  paymentMode?: string
  inactiveDays?: number
  sort?: string
  page?: number
  perPage?: number
}

class DriverRecordRepository {
  async index(): Promise<DriverInterface[]> {
    const drivers = await DriverRecord.findAll({
      order: [['created_at', 'DESC']],
    })

    return drivers.map((driver) => this.mapDriver(driver))
  }

  async list(query: DriverListQuery): Promise<{ rows: DriverInterface[]; total: number }> {
    const SORT_WHITELIST = ['name', 'created_at', 'last_connection', 'balance']
    const page = Math.max(1, query.page ?? 1)
    const perPage = query.perPage ?? 30

    const sortRaw = query.sort ?? 'name'
    const descending = sortRaw.startsWith('-')
    const sortField = descending ? sortRaw.slice(1) : sortRaw
    if (!SORT_WHITELIST.includes(sortField)) {
      throw new Error(`Invalid sort field: "${sortField}". Allowed: ${SORT_WHITELIST.join(', ')}`)
    }
    const order: any[] = [[sortField, descending ? 'DESC' : 'ASC']]

    const andWhere: WhereOptions<any>[] = []
    const replacements: Record<string, any> = {}

    if (query.search) {
      const searchPattern = `%${query.search}%`
      replacements['search'] = searchPattern
      andWhere.push({
        [Op.or]: [
          { name: { [Op.iLike]: searchPattern } },
          { email: { [Op.iLike]: searchPattern } },
          { phone: { [Op.iLike]: searchPattern } },
          { document: { [Op.iLike]: searchPattern } },
          literal(`vehicle->>'plate' ILIKE :search`),
        ],
      })
    }

    if (query.status === 'enabled') {
      andWhere.push({ enabled_at: { [Op.gt]: 0 } })
    } else if (query.status === 'disabled') {
      andWhere.push({ enabled_at: 0 })
    }

    if (query.paymentMode) {
      andWhere.push({ paymentMode: query.paymentMode })
    }

    if (query.inactiveDays !== undefined && query.inactiveDays > 0) {
      const cutoff = Math.floor(Date.now() / 1000) - query.inactiveDays * 86400
      andWhere.push({
        last_connection: {
          [Op.gt]: 0,
          [Op.lt]: cutoff,
        },
      })
    }

    const where: WhereOptions<any> = andWhere.length > 0 ? { [Op.and]: andWhere } : {}

    const { count, rows } = await DriverRecord.findAndCountAll({
      where,
      order,
      limit: perPage,
      offset: (page - 1) * perPage,
      replacements,
    })

    return {
      rows: rows.map((driver) => this.mapDriver(driver)),
      total: count,
    }
  }

  async findById(id: string): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    return driver ? this.mapDriver(driver) : null
  }

  async store(payload: DriverInterface): Promise<DriverInterface> {
    const { availability: _availability, ...driverPayload } = payload
    const [driver] = await DriverRecord.upsert(
      {
        ...driverPayload,
        password: driverPayload.password ?? null,
        phone2: driverPayload.phone2 ?? null,
        paymentMode: driverPayload.paymentMode ?? 'monthly',
        photoUrl: driverPayload.photoUrl ?? null,
        device: driverPayload.device ?? null,
        balance: driverPayload.balance ?? 0,
        last_connection: driverPayload.last_connection ?? 0,
      },
      { returning: true }
    )

    return this.mapDriver(driver)
  }

  async setEnabled(id: string, enabledAt: number): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    if (!driver) return null

    driver.enabled_at = enabledAt
    await driver.save()
    return this.mapDriver(driver)
  }

  async bulkSetEnabled(
    driverIds: string[],
    enabledAt: number
  ): Promise<{ processed: number; failed: Array<{ id: string; reason: string }> }> {
    const failed: Array<{ id: string; reason: string }> = []
    let processed = 0

    const CHUNK_SIZE = 10
    for (let i = 0; i < driverIds.length; i += CHUNK_SIZE) {
      const chunk = driverIds.slice(i, i + CHUNK_SIZE)
      const results = await Promise.allSettled(
        chunk.map(async (id) => {
          const driver = await DriverRecord.findByPk(id)
          if (!driver) throw new Error('Driver not found')
          driver.enabled_at = enabledAt
          await driver.save()
        })
      )
      results.forEach((result, index) => {
        const id = chunk[index]
        if (result.status === 'fulfilled') {
          processed++
        } else {
          const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          failed.push({ id, reason })
        }
      })
    }

    return { processed, failed }
  }

  async updateEmail(id: string, email: string): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    if (!driver) return null

    driver.email = email
    await driver.save()
    return this.mapDriver(driver)
  }

  async updatePassword(id: string, password: string): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    if (!driver) return null

    driver.password = password
    await driver.save()
    return this.mapDriver(driver)
  }

  async updateBalance(id: string, balance: number): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    if (!driver) return null

    driver.balance = balance
    if (driver.paymentMode === 'percentage' && balance <= 0) {
      driver.enabled_at = 0
    }
    await driver.save()
    return this.mapDriver(driver)
  }

  async updateDevice(
    id: string,
    device: Record<string, any> | null
  ): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    if (!driver) return null

    driver.device = device
    await driver.save()
    return this.mapDriver(driver)
  }

  async updateLastConnection(id: string, lastConnection: number): Promise<DriverInterface | null> {
    const driver = await DriverRecord.findByPk(id)
    if (!driver) return null

    driver.last_connection = lastConnection
    await driver.save()
    return this.mapDriver(driver)
  }

  toDriverModel(driverData: DriverInterface): Driver {
    const driver = new Driver()
    Object.assign(driver, driverData)
    return driver
  }

  private mapDriver(driver: DriverRecord): DriverInterface {
    const plain = driver.get({ plain: true }) as any
    return {
      id: plain.id,
      name: plain.name,
      email: plain.email,
      password: plain.password ?? null,
      phone: plain.phone,
      phone2: plain.phone2 ?? null,
      docType: plain.docType,
      paymentMode: plain.paymentMode ?? 'monthly',
      document: plain.document,
      photoUrl: plain.photoUrl ?? null,
      vehicle: plain.vehicle ?? {},
      device: plain.device ?? null,
      balance: Number(plain.balance ?? 0),
      enabled_at: Number(plain.enabled_at ?? 0),
      created_at: Number(plain.created_at ?? 0),
      last_connection: Number(plain.last_connection ?? 0),
      availability: buildDriverAvailability({
        paymentMode: plain.paymentMode ?? 'monthly',
        balance: Number(plain.balance ?? 0),
        enabled_at: Number(plain.enabled_at ?? 0),
      }),
    }
  }
}

export default DriverRecordRepository
