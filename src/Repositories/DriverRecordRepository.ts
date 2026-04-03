import DriverRecord from '../Models/DriverRecord'
import { DriverInterface } from '../Interfaces/DriverInterface'
import Driver from '../Models/Driver'

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
    const [driver] = await DriverRecord.upsert(
      {
        ...payload,
        password: payload.password ?? null,
        phone2: payload.phone2 ?? null,
        paymentMode: payload.paymentMode ?? 'monthly',
        photoUrl: payload.photoUrl ?? null,
        device: payload.device ?? null,
        balance: payload.balance ?? 0,
        last_connection: payload.last_connection ?? 0,
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
    await driver.save()
    return this.mapDriver(driver)
  }

  async updateDevice(id: string, device: Record<string, any> | null): Promise<DriverInterface | null> {
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
    }
  }
}

export default DriverRecordRepository
