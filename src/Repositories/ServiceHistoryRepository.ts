import { Op, WhereOptions, fn, col, literal } from 'sequelize'
import ServiceHistoryRecord from '../Models/ServiceHistoryRecord'
import { ServiceInterface } from '../Interfaces/ServiceInterface'
import ChatIdHelper from '../Helpers/ChatIdHelper'

type HistoryFilters = {
  from?: number
  to?: number
  clientId?: string
  driverId?: string
  status?: string
  perPage?: number
  direction?: 'next' | 'prev'
  cursorCreated?: number
  cursorId?: string
}

type TopDriverMetric = {
  driverId: string
  count: number
}

class ServiceHistoryRepository {
  async listByDriver(driverId: string, filters: HistoryFilters = {}): Promise<ServiceInterface[]> {
    const where = this.buildWhere({
      ...filters,
      driverId,
    })

    const services = await ServiceHistoryRecord.findAll({
      where,
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    })

    return services.map((service) => service.get({ plain: true }) as ServiceInterface)
  }

  async listPage(filters: HistoryFilters = {}): Promise<ServiceInterface[]> {
    const direction = filters.direction ?? 'next'
    const perPage = filters.perPage ?? 20
    const where = this.buildWhere(filters)
    const isPrevPage =
      direction === 'prev' && filters.cursorCreated !== undefined && filters.cursorId
    const order: any = isPrevPage
      ? [
          ['created_at', 'ASC'],
          ['id', 'ASC'],
        ]
      : [
          ['created_at', 'DESC'],
          ['id', 'DESC'],
        ]

    const rows = await ServiceHistoryRecord.findAll({
      where,
      order,
      limit: perPage,
    })

    const services = rows.map((service) => service.get({ plain: true }) as ServiceInterface)
    return isPrevPage ? services.reverse() : services
  }

  async count(filters: HistoryFilters = {}): Promise<number> {
    return ServiceHistoryRecord.count({
      where: this.buildWhere(filters),
    })
  }

  async listTopDrivers(filters: Pick<HistoryFilters, 'from' | 'to'>): Promise<TopDriverMetric[]> {
    const rows = await ServiceHistoryRecord.findAll({
      attributes: [
        ['driver_id', 'driverId'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: this.buildWhere(
        {
          ...filters,
          status: 'terminated',
        },
        true
      ),
      group: ['driver_id'],
      order: [literal('"count" DESC'), ['driver_id', 'ASC']],
      limit: 5,
      raw: true,
    })

    return rows.map((row: any) => ({
      driverId: row.driverId,
      count: Number(row.count),
    }))
  }

  private buildWhere(filters: HistoryFilters = {}, excludeEmptyDriver = false): WhereOptions<any> {
    const andWhere: WhereOptions<any>[] = []

    if (filters.from !== undefined || filters.to !== undefined) {
      const createdAtFilter: Record<symbol, number> = {} as Record<symbol, number>
      if (filters.from !== undefined) {
        createdAtFilter[Op.gte] = filters.from
      }
      if (filters.to !== undefined) {
        createdAtFilter[Op.lte] = filters.to
      }
      andWhere.push({ created_at: createdAtFilter })
    }

    if (filters.clientId) {
      andWhere.push({ client_id: ChatIdHelper.toCanonicalClientId(filters.clientId) })
    }

    if (filters.driverId) {
      andWhere.push({ driver_id: filters.driverId })
    }

    if (filters.status) {
      andWhere.push({ status: filters.status })
    }

    if (excludeEmptyDriver) {
      andWhere.push({
        driver_id: {
          [Op.not]: null,
          [Op.ne]: '',
        },
      })
    }

    if (filters.cursorCreated !== undefined && filters.cursorId) {
      if ((filters.direction ?? 'next') === 'prev') {
        andWhere.push({
          [Op.or]: [
            {
              created_at: {
                [Op.gt]: filters.cursorCreated,
              },
            },
            {
              created_at: filters.cursorCreated,
              id: {
                [Op.gt]: filters.cursorId,
              },
            },
          ],
        })
      } else {
        andWhere.push({
          [Op.or]: [
            {
              created_at: {
                [Op.lt]: filters.cursorCreated,
              },
            },
            {
              created_at: filters.cursorCreated,
              id: {
                [Op.lt]: filters.cursorId,
              },
            },
          ],
        })
      }
    }

    if (andWhere.length === 0) {
      return {}
    }

    if (andWhere.length === 1) {
      return andWhere[0]
    }

    return {
      [Op.and]: andWhere,
    }
  }
}

export default ServiceHistoryRepository
