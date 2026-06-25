import { Op, literal } from 'sequelize'
import sequelize from '../Database/sequelize'
import MonthlyPaymentRecord from '../Models/MonthlyPaymentRecord'
import DriverRecord from '../Models/DriverRecord'
import { MonthlyPaymentInterface } from '../Interfaces/MonthlyPaymentInterface'
import { DriverInterface } from '../Interfaces/DriverInterface'
import { buildDriverAvailability } from '../Services/drivers/DriverAvailability'
import { currentPeriod } from '../Services/time/BogotaTime'

class MonthlyPaymentRepository {
  async create({
    driverId,
    period,
    amount,
    createdBy,
    note,
  }: {
    driverId: string
    period: string
    amount: number
    createdBy: { uid: string; name: string }
    note?: string | null
  }): Promise<{ payment: MonthlyPaymentInterface; driver: DriverInterface }> {
    const txn = await sequelize.transaction()
    try {
      const driver = await DriverRecord.findOne({
        where: { id: driverId },
        lock: true,
        transaction: txn,
      })

      if (!driver) {
        throw new Error('Driver not found')
      }

      const payment = await MonthlyPaymentRecord.create(
        {
          driverId,
          period,
          amount,
          createdByUid: createdBy.uid,
          createdByName: createdBy.name,
          note: note ?? null,
          created_at: Math.floor(Date.now() / 1000),
        } as any,
        { transaction: txn }
      )

      if (period === currentPeriod()) {
        driver.enabled_at = Math.floor(Date.now() / 1000)
        await driver.save({ transaction: txn })
      }

      await txn.commit()

      return { payment: this.mapPayment(payment), driver: this.mapDriver(driver) }
    } catch (error) {
      await txn.rollback()
      throw error
    }
  }

  async listForDriver(
    driverId: string,
    { page, perPage }: { page?: number; perPage?: number } = {}
  ): Promise<{ rows: MonthlyPaymentInterface[]; total: number }> {
    const resolvedPerPage = perPage ?? 20
    const resolvedPage = page ?? 1

    const { count, rows } = await MonthlyPaymentRecord.findAndCountAll({
      where: { driverId },
      order: [['created_at', 'DESC']],
      limit: resolvedPerPage,
      offset: (resolvedPage - 1) * resolvedPerPage,
    })

    return { rows: rows.map((r) => this.mapPayment(r)), total: count }
  }

  async hasPaymentForPeriod(driverId: string, period: string): Promise<boolean> {
    const count = await MonthlyPaymentRecord.count({
      where: { driverId, period },
    })

    return count > 0
  }

  async findUnpaidMonthlyDriverIds(period: string): Promise<string[]> {
    const drivers = await DriverRecord.findAll({
      attributes: ['id'],
      where: {
        [Op.and]: [
          { paymentMode: 'monthly' },
          { enabled_at: { [Op.gt]: 0 } },
          literal(`NOT EXISTS (
            SELECT 1 FROM driver_monthly_payments dmp
            WHERE dmp.driver_id = "DriverRecord"."id"
            AND dmp.period = :period
          )`),
        ],
      },
      replacements: { period },
    })

    return drivers.map((d) => d.id)
  }

  private mapPayment(p: MonthlyPaymentRecord): MonthlyPaymentInterface {
    const plain = p.get({ plain: true }) as any
    return {
      id: plain.id,
      driverId: plain.driverId,
      period: plain.period,
      amount: Number(plain.amount),
      createdByUid: plain.createdByUid,
      createdByName: plain.createdByName,
      note: plain.note ?? null,
      created_at: Number(plain.created_at),
    }
  }

  private mapDriver(d: DriverRecord): DriverInterface {
    const plain = d.get({ plain: true }) as any
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
      selected_vehicle_id: plain.selected_vehicle_id ?? null,
      availability: buildDriverAvailability({
        paymentMode: plain.paymentMode ?? 'monthly',
        balance: Number(plain.balance ?? 0),
        enabled_at: Number(plain.enabled_at ?? 0),
      }),
    }
  }
}

export default MonthlyPaymentRepository
