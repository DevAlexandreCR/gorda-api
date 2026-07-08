import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { Op } from 'sequelize'
import Service from '../../Models/Service'
import { ServiceInterface } from '../../Interfaces/ServiceInterface'
import ServiceHistoryRecord from '../../Models/ServiceHistoryRecord'
import ServiceMetricsDailyRepository from '../../Repositories/ServiceMetricsDailyRepository'
import ServiceRepository from '../../Repositories/ServiceRepository'
import ChatIdHelper from '../../Helpers/ChatIdHelper'
import VehicleRepository from '../../Repositories/VehicleRepository'

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
      attributes: ['status', 'deducted_value'],
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
    const commissionSums = new Map<string, number>()
    FINAL_STATUSES.forEach((status) => {
      counts.set(status, 0)
      commissionSums.set(status, 0)
    })

    rows.forEach((row: any) => {
      const status = row.status as string
      const deductedValue = Number(row.deducted_value) || 0
      counts.set(status, (counts.get(status) ?? 0) + 1)
      commissionSums.set(status, (commissionSums.get(status) ?? 0) + deductedValue)
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
        commission_sum: commissionSums.get(status) ?? 0,
      })
    }
  }

  async rebuildAllMetrics(): Promise<number> {
    const rows = await ServiceHistoryRecord.findAll({
      attributes: ['created_at', 'status', 'deducted_value'],
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
    const groupedCommissionSums = new Map<string, number>()

    rows.forEach((row: any) => {
      const date = this.getMetricDate(Number(row.created_at))
      const key = `${date}:${row.status}`
      const deductedValue = Number(row.deducted_value) || 0
      grouped.set(key, (grouped.get(key) ?? 0) + 1)
      groupedCommissionSums.set(key, (groupedCommissionSums.get(key) ?? 0) + deductedValue)
    })

    const metrics = Array.from(grouped.entries()).map(([key, count]) => {
      const [date, status] = key.split(':')
      return {
        date,
        status,
        count,
        commission_sum: groupedCommissionSums.get(key) ?? 0,
      }
    })

    return this.metricsRepository.rebuildAll(metrics)
  }

  async upsertHistoryRecord(service: ServiceInterface): Promise<void> {
    const payload: any = this.buildHistoryPayload(service)
    if (service.vehicle?.plate && !payload.vehicle_id) {
      const vehicleRepo = new VehicleRepository()
      const vehicle = await vehicleRepo.findByNormalizedPlate(service.vehicle.plate)
      if (vehicle) payload.vehicle_id = vehicle.id
    }
    await ServiceHistoryRecord.upsert(payload)
  }

  private buildHistoryPayload(
    service: ServiceInterface
  ): Omit<ServiceInterface, 'client_completed_services_count'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { client_completed_services_count, ...persist } = service
    return {
      id: persist.id,
      status: persist.status,
      start_loc: persist.start_loc,
      end_loc: persist.end_loc ?? null,
      phone: persist.phone,
      name: persist.name,
      comment: persist.comment ?? null,
      amount: persist.amount ?? null,
      metadata: persist.metadata ?? {},
      driver_id: persist.driver_id ?? null,
      client_id: ChatIdHelper.toCanonicalClientId(persist.client_id),
      wp_client_id: persist.wp_client_id ?? null,
      created_at: Number(persist.created_at),
      created_by: persist.created_by ?? null,
      origin: persist.origin ?? null,
      assigned_by: persist.assigned_by ?? null,
      canceled_by: persist.canceled_by ?? null,
      terminated_by: persist.terminated_by ?? null,
      vehicle_id: persist.vehicle_id ?? null,
      deducted_value: Number(persist.metadata?.discount ?? 0),
    }
  }
}

export { FINAL_STATUSES }
export default ServiceHistoryMigrationService
