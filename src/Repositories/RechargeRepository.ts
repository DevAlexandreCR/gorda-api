import { Op, fn, col } from 'sequelize'
import sequelize from '../Database/sequelize'
import RechargeRecord from '../Models/RechargeRecord'
import DriverRecord from '../Models/DriverRecord'
import { RechargeInterface } from '../Interfaces/RechargeInterface'
import { DriverInterface } from '../Interfaces/DriverInterface'
import { buildDriverAvailability } from '../Services/drivers/DriverAvailability'
import { BOGOTA_TIMEZONE, periodStart, periodEnd } from '../Services/time/BogotaTime'

class RechargeRepository {
  async create({
    driverId,
    amount,
    createdBy,
    note,
  }: {
    driverId: string
    amount: number
    createdBy: { uid: string; name: string }
    note?: string | null
  }): Promise<{ recharge: RechargeInterface; driver: DriverInterface }> {
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

      const balanceBefore = Number(driver.balance ?? 0)
      const balanceAfter = balanceBefore + amount

      driver.balance = balanceAfter
      if (driver.paymentMode === 'percentage' && balanceAfter <= 0) {
        driver.enabled_at = 0
      }
      await driver.save({ transaction: txn })

      const recharge = await RechargeRecord.create(
        {
          driverId,
          amount,
          balanceBefore,
          balanceAfter,
          createdByUid: createdBy.uid,
          createdByName: createdBy.name,
          note: note ?? null,
          created_at: Math.floor(Date.now() / 1000),
        } as any,
        { transaction: txn }
      )

      await txn.commit()

      return { recharge: this.mapRecharge(recharge), driver: this.mapDriver(driver) }
    } catch (error) {
      await txn.rollback()
      throw error
    }
  }

  async listForDriver(
    driverId: string,
    { page, perPage }: { page?: number; perPage?: number } = {}
  ): Promise<{ rows: RechargeInterface[]; total: number }> {
    const resolvedPerPage = perPage ?? 20
    const resolvedPage = page ?? 1

    const { count, rows } = await RechargeRecord.findAndCountAll({
      where: { driverId },
      order: [['created_at', 'DESC']],
      limit: resolvedPerPage,
      offset: (resolvedPage - 1) * resolvedPerPage,
    })

    return { rows: rows.map((r) => this.mapRecharge(r)), total: count }
  }

  /**
   * Per-month SUM(amount) and COUNT(*), grouped by the Bogota-month of the
   * BIGINT unix `created_at` (converted in SQL via `to_timestamp` + `timezone`,
   * matching the rollup's day convention). `from`/`to` are `YYYY-MM` period
   * strings; the query is bounded to their Bogota month-start/end unix
   * boundaries so it never scans rows outside the requested range.
   */
  async getRevenueByPeriodRange(
    from: string,
    to: string
  ): Promise<Array<{ period: string; amount: number; count: number }>> {
    const startUnix = periodStart(from)
    const endUnix = periodEnd(to)

    const rows = await RechargeRecord.findAll({
      attributes: [
        [
          fn(
            'to_char',
            fn('timezone', BOGOTA_TIMEZONE, fn('to_timestamp', col('created_at'))),
            'YYYY-MM'
          ),
          'period',
        ],
        [fn('SUM', col('amount')), 'amount'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: {
        created_at: {
          [Op.gte]: startUnix,
          [Op.lte]: endUnix,
        },
      },
      group: ['period'],
      raw: true,
    })

    return rows.map((row: any) => ({
      period: row.period,
      amount: Number(row.amount ?? 0),
      count: Number(row.count ?? 0),
    }))
  }

  private mapRecharge(r: RechargeRecord): RechargeInterface {
    const plain = r.get({ plain: true }) as any
    return {
      id: plain.id,
      driverId: plain.driverId,
      amount: Number(plain.amount),
      balanceBefore: Number(plain.balanceBefore),
      balanceAfter: Number(plain.balanceAfter),
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

export default RechargeRepository
