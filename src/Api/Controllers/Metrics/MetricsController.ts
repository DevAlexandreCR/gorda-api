import { Request, Response, Router } from 'express'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { BOGOTA_TIMEZONE, PERIOD_FORMAT } from '../../../Services/time/BogotaTime'

dayjs.extend(utc)
dayjs.extend(timezone)

const controller = Router()

controller.use(requireAuth)

controller.get('/global', async (req: Request, res: Response) => {
  try {
    const startDate = String(req.query.startDate ?? '').trim()
    const endDate = String(req.query.endDate ?? '').trim()

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
        data: {},
      })
    }

    const metrics = await Container.getServiceMetricsDailyRepository().listGlobal(
      startDate,
      endDate
    )

    return res.status(200).json({
      success: true,
      data: metrics,
    })
  } catch (error) {
    console.error('Error fetching global metrics:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/top-drivers', async (req: Request, res: Response) => {
  try {
    const frequency = String(req.query.frequency ?? 'daily')
    const from = Number(req.query.from)
    const to = Number(req.query.to)

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return res.status(400).json({
        success: false,
        message: 'from and to are required numeric unix timestamps',
        data: {},
      })
    }

    if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') {
      return res.status(400).json({
        success: false,
        message: 'frequency must be daily, weekly, or monthly',
        data: {},
      })
    }

    const drivers = await Container.getServiceHistoryRepository().listTopDrivers({
      from,
      to,
    })

    return res.status(200).json({
      success: true,
      data: { drivers },
    })
  } catch (error) {
    console.error('Error fetching top-driver metrics:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

type RevenuePeriod = {
  period: string
  commissionSum: number
  monthlyFeeSum: number
  payingDriverCount: number
  rechargeSum: number
  rechargeCount: number
}

function enumeratePeriods(from: string, to: string): string[] {
  const periods: string[] = []
  let cursor = dayjs.tz(`${from}-01`, 'America/Bogota')

  while (cursor.format('YYYY-MM') <= to) {
    periods.push(cursor.format('YYYY-MM'))
    cursor = cursor.add(1, 'month')
  }

  return periods
}

controller.get('/revenue', async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from ?? '').trim()
    const to = String(req.query.to ?? '').trim()

    if (!PERIOD_FORMAT.test(from) || !PERIOD_FORMAT.test(to)) {
      return res.status(400).json({
        success: false,
        message: 'from and to are required in YYYY-MM format',
        data: {},
      })
    }

    if (from > to) {
      return res.status(400).json({
        success: false,
        message: 'from must be before or equal to to',
        data: {},
      })
    }

    const commissionStartDate = `${from}-01`
    const commissionEndDate = dayjs
      .tz(`${to}-01`, BOGOTA_TIMEZONE)
      .endOf('month')
      .format('YYYY-MM-DD')

    const [commissionRows, monthlyPaymentRows, rechargeRows] = await Promise.all([
      Container.getServiceMetricsDailyRepository().getCommissionByMonth(
        commissionStartDate,
        commissionEndDate,
        'terminated'
      ),
      Container.getMonthlyPaymentRepository().getRevenueByPeriodRange(from, to),
      Container.getRechargeRepository().getRevenueByPeriodRange(from, to),
    ])

    const periods = enumeratePeriods(from, to)
    const revenueByPeriod = new Map<string, RevenuePeriod>(
      periods.map((period) => [
        period,
        {
          period,
          commissionSum: 0,
          monthlyFeeSum: 0,
          payingDriverCount: 0,
          rechargeSum: 0,
          rechargeCount: 0,
        },
      ])
    )

    commissionRows.forEach((row) => {
      const entry = revenueByPeriod.get(row.period)
      if (entry) entry.commissionSum = row.commissionSum
    })

    monthlyPaymentRows.forEach((row) => {
      const entry = revenueByPeriod.get(row.period)
      if (entry) {
        entry.monthlyFeeSum = row.amount
        entry.payingDriverCount = row.payingDriverCount
      }
    })

    rechargeRows.forEach((row) => {
      const entry = revenueByPeriod.get(row.period)
      if (entry) {
        entry.rechargeSum = row.amount
        entry.rechargeCount = row.count
      }
    })

    const data = periods.map((period) => revenueByPeriod.get(period) as RevenuePeriod)

    return res.status(200).json({
      success: true,
      data,
    })
  } catch (error) {
    console.error('Error fetching revenue metrics:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
