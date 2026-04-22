import DriverRecord from '../Models/DriverRecord'
import { DriverInterface } from '../Interfaces/DriverInterface'
import Driver from '../Models/Driver'
import { buildDriverAvailability } from '../Services/drivers/DriverAvailability'

class DriverRecordRepository {
  async index(): Promise<DriverInterface[]> {
    const drivers = await DriverRecord.findAll({
      order: [['created_at', 'DESC']],
    })

    return drivers.map((driver) => this.mapDriver(driver))
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
