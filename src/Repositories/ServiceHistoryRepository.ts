import { Op, WhereOptions } from 'sequelize'
import ServiceHistoryRecord from '../Models/ServiceHistoryRecord'
import { ServiceInterface } from '../Interfaces/ServiceInterface'

type HistoryFilters = {
  from?: number
  to?: number
}

class ServiceHistoryRepository {
  async listByDriver(driverId: string, filters: HistoryFilters = {}): Promise<ServiceInterface[]> {
    const where: WhereOptions<any> = {
      driver_id: driverId,
    }

    if (filters.from !== undefined || filters.to !== undefined) {
      const createdAtFilter: Record<symbol, number> = {} as Record<symbol, number>
      if (filters.from !== undefined) {
        createdAtFilter[Op.gte] = filters.from
      }
      if (filters.to !== undefined) {
        createdAtFilter[Op.lte] = filters.to
      }
      where.created_at = createdAtFilter
    }

    const services = await ServiceHistoryRecord.findAll({
      where,
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    })

    return services.map((service) => service.get({ plain: true }) as ServiceInterface)
  }
}

export default ServiceHistoryRepository
