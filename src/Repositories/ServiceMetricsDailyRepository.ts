import { Op } from 'sequelize'
import ServiceMetricDailyRecord from '../Models/ServiceMetricDailyRecord'
import { ServiceMetricDailyInterface } from '../Interfaces/ServiceMetricDailyInterface'
import { MetricType } from '../Types/MetricType'

type GlobalMetric = {
  date: string
  type: MetricType
  status: string
  count: number
}

class ServiceMetricsDailyRepository {
  async upsert(metric: ServiceMetricDailyInterface): Promise<ServiceMetricDailyInterface> {
    const [record] = await ServiceMetricDailyRecord.upsert(metric, { returning: true })
    return record.get({ plain: true }) as ServiceMetricDailyInterface
  }

  async delete(date: string, status: string): Promise<void> {
    await ServiceMetricDailyRecord.destroy({
      where: {
        date,
        status,
      },
    })
  }

  async rebuildAll(metrics: ServiceMetricDailyInterface[]): Promise<number> {
    await ServiceMetricDailyRecord.destroy({ where: {} })

    if (metrics.length > 0) {
      await ServiceMetricDailyRecord.bulkCreate(metrics)
    }

    return metrics.length
  }

  async listGlobal(startDate: string, endDate: string): Promise<GlobalMetric[]> {
    const rows = await ServiceMetricDailyRecord.findAll({
      where: {
        date: {
          [Op.gte]: startDate,
          [Op.lte]: endDate,
        },
      },
      order: [
        ['date', 'ASC'],
        ['status', 'ASC'],
      ],
    })

    return rows.map((row) => ({
      date: row.date,
      type: MetricType.Global,
      status: row.status,
      count: Number(row.count),
    }))
  }
}

export default ServiceMetricsDailyRepository
