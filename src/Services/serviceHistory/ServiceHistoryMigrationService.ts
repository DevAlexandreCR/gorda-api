import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { Op } from 'sequelize'
import Service from '../../Models/Service'
import { ServiceInterface } from '../../Interfaces/ServiceInterface'
import ServiceHistoryRecord from '../../Models/ServiceHistoryRecord'
import ServiceMetricsDailyRepository from '../../Repositories/ServiceMetricsDailyRepository'
import ServiceRepository from '../../Repositories/ServiceRepository'

dayjs.extend(utc)
dayjs.extend(timezone)

const HISTORY_BOUNDARY = dayjs.tz('2026-01-01 00:00:00', 'America/Bogota').unix()
const FINAL_STATUSES = [Service.STATUS_TERMINATED, Service.STATUS_CANCELED]

type FinalizeResult = {
  eligible: boolean
  upserted: boolean
  metricDate?: string
  reason?: string
}

class ServiceHistoryMigrationService {
  constructor(private readonly metricsRepository = new ServiceMetricsDailyRepository()) {}

  getBoundaryUnix(): number {
    return HISTORY_BOUNDARY
  }

  isEligibleFinalService(
    service: ServiceInterface | null | undefined
  ): service is ServiceInterface {
    if (!service?.id) return false
    if (!FINAL_STATUSES.includes(service.status)) return false
    return Number(service.created_at) >= HISTORY_BOUNDARY
  }

  getMetricDate(createdAt: number): string {
    return dayjs.unix(createdAt).tz('America/Bogota').format('YYYY-MM-DD')
  }

  async finalizeServiceById(serviceId: string): Promise<FinalizeResult> {
    const service = await ServiceRepository.findServiceById(serviceId)
    return this.upsertEligibleService(service)
  }

  async upsertEligibleService(
    service: ServiceInterface | null | undefined
  ): Promise<FinalizeResult> {
    if (!service) {
      return {
        eligible: false,
        upserted: false,
        reason: 'service_not_found',
      }
    }

    if (!this.isEligibleFinalService(service)) {
      return {
        eligible: false,
        upserted: false,
        reason: 'service_not_eligible',
      }
    }

    await this.upsertHistoryRecord(service)
    const metricDate = this.getMetricDate(Number(service.created_at))
    await this.rebuildMetricsForDate(metricDate)

    return {
      eligible: true,
      upserted: true,
      metricDate,
    }
  }

  async rebuildMetricsForDate(metricDate: string): Promise<void> {
    const start = dayjs.tz(`${metricDate} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', 'America/Bogota').unix()
    const end = dayjs.tz(`${metricDate} 23:59:59`, 'YYYY-MM-DD HH:mm:ss', 'America/Bogota').unix()
    const rows = await ServiceHistoryRecord.findAll({
      attributes: ['status'],
      where: {
        created_at: {
          [Op.gte]: start,
          [Op.lte]: end,
        },
        status: {
          [Op.in]: FINAL_STATUSES,
        },
      },
      raw: true,
    })

    const counts = new Map<string, number>()
    FINAL_STATUSES.forEach((status) => counts.set(status, 0))

    rows.forEach((row: any) => {
      const status = row.status as string
      counts.set(status, (counts.get(status) ?? 0) + 1)
    })

    for (const status of FINAL_STATUSES) {
      const count = counts.get(status) ?? 0
      if (count <= 0) {
        await this.metricsRepository.delete(metricDate, status)
        continue
      }

      await this.metricsRepository.upsert({
        date: metricDate,
        status,
        count,
      })
    }
  }

  async rebuildAllMetrics(): Promise<number> {
    const rows = await ServiceHistoryRecord.findAll({
      attributes: ['created_at', 'status'],
      where: {
        status: {
          [Op.in]: FINAL_STATUSES,
        },
      },
      raw: true,
      order: [
        ['created_at', 'ASC'],
        ['id', 'ASC'],
      ],
    })

    const grouped = new Map<string, number>()

    rows.forEach((row: any) => {
      const date = this.getMetricDate(Number(row.created_at))
      const key = `${date}:${row.status}`
      grouped.set(key, (grouped.get(key) ?? 0) + 1)
    })

    const metrics = Array.from(grouped.entries()).map(([key, count]) => {
      const [date, status] = key.split(':')
      return {
        date,
        status,
        count,
      }
    })

    return this.metricsRepository.rebuildAll(metrics)
  }

  async upsertHistoryRecord(service: ServiceInterface): Promise<void> {
    await ServiceHistoryRecord.upsert(this.buildHistoryPayload(service))
  }

  private buildHistoryPayload(service: ServiceInterface): ServiceInterface {
    return {
      id: service.id,
      status: service.status,
      start_loc: service.start_loc,
      end_loc: service.end_loc ?? null,
      phone: service.phone,
      name: service.name,
      comment: service.comment ?? null,
      amount: service.amount ?? null,
      metadata: service.metadata ?? {},
      driver_id: service.driver_id ?? null,
      client_id: service.client_id,
      wp_client_id: service.wp_client_id ?? null,
      created_at: Number(service.created_at),
      created_by: service.created_by ?? null,
      assigned_by: service.assigned_by ?? null,
      canceled_by: service.canceled_by ?? null,
      terminated_by: service.terminated_by ?? null,
    }
  }
}

export { FINAL_STATUSES }
export default ServiceHistoryMigrationService
