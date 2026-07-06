import { Op, WhereOptions, fn, col, literal } from 'sequelize'
import ServiceHistoryRecord from '../Models/ServiceHistoryRecord'
import { ServiceInterface } from '../Interfaces/ServiceInterface'
import ChatIdHelper from '../Helpers/ChatIdHelper'
import VehicleRepository from './VehicleRepository'

const vehicleRepo = new VehicleRepository()

/**
 * Guarded numeric cast for metadata.trip_distance (design.md Decision 1).
 * Postgres 15 has no pg_input_is_valid, so a bare `::numeric` cast aborts the
 * whole query on the first non-numeric value in dirty legacy JSONB. Missing,
 * non-numeric, and negative values all resolve to 0 (flagged), never to a
 * query error.
 */
const TRIP_DISTANCE_SQL = `
  CASE
    WHEN metadata->>'trip_distance' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (metadata->>'trip_distance')::numeric
    ELSE 0
  END
`

/**
 * Canonical route-flagged rule (design.md Decision 1 / spec "single canonical
 * rule"): a terminated service that went through the trip flow
 * (metadata.start_trip_at present) with no usable route capture
 * (missing/empty/serialized "{}") or a non-positive/non-numeric trip_distance.
 * Kept as raw SQL so the aggregation FILTER clause and the history WHERE
 * filter compose it identically and can never disagree.
 */
const ROUTE_FLAGGED_SQL = `
  status = 'terminated'
  AND metadata->>'start_trip_at' IS NOT NULL
  AND (
    metadata->>'route' IS NULL
    OR metadata->>'route' = ''
    OR metadata->>'route' = '{}'
    OR (${TRIP_DISTANCE_SQL}) <= 0
  )
`

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
  routeIntegrity?: 'flagged'
}

type TopDriverMetric = {
  driverId: string
  count: number
}

type RouteIntegrityMetric = {
  driver_id: string
  total_trips: number
  flagged_trips: number
  flagged_ratio: number
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
    await this.attachVehicles(services)
    return isPrevPage ? services.reverse() : services
  }

  private async attachVehicles(services: ServiceInterface[]): Promise<void> {
    const vehicleIds = Array.from(
      new Set(services.map((service) => service.vehicle_id).filter((id): id is string => !!id))
    )

    const vehicles = await vehicleRepo.findByIds(vehicleIds)
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

    for (const service of services) {
      const vehicle = service.vehicle_id ? vehicleById.get(service.vehicle_id) : undefined
      service.vehicle = vehicle
        ? { plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model, color: vehicle.color }
        : null
    }
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

  /**
   * Sequelize `literal()` wrapper around the canonical route-flagged rule,
   * for composing it into a `WhereOptions` (buildWhere) or a `COUNT(*) FILTER`
   * attribute (aggregateRouteIntegrity).
   */
  private routeFlaggedCondition() {
    return literal(ROUTE_FLAGGED_SQL)
  }

  /**
   * Per-driver route-integrity aggregation (design.md Decision 2): one
   * GROUP BY driver_id query denominated on terminated trips that went
   * through the trip flow (metadata.start_trip_at present), with
   * flagged_trips computed via the shared canonical rule so the aggregate
   * can never disagree with the drill-down list.
   */
  async aggregateRouteIntegrity(
    filters: Pick<HistoryFilters, 'from' | 'to' | 'driverId'>
  ): Promise<RouteIntegrityMetric[]> {
    const baseWhere = this.buildWhere(
      {
        from: filters.from,
        to: filters.to,
        driverId: filters.driverId,
        status: 'terminated',
      },
      true
    )

    const where: WhereOptions<any> = {
      [Op.and]: [baseWhere, literal(`metadata->>'start_trip_at' IS NOT NULL`)],
    }

    const rows = await ServiceHistoryRecord.findAll({
      attributes: [
        'driver_id',
        [literal('COUNT(*)'), 'total_trips'],
        [literal(`COUNT(*) FILTER (WHERE ${ROUTE_FLAGGED_SQL})`), 'flagged_trips'],
      ],
      where,
      group: ['driver_id'],
      order: [literal('"flagged_trips" DESC')],
      raw: true,
    })

    return rows.map((row: any) => {
      const totalTrips = Number(row.total_trips)
      const flaggedTrips = Number(row.flagged_trips)
      return {
        driver_id: row.driver_id,
        total_trips: totalTrips,
        flagged_trips: flaggedTrips,
        flagged_ratio: totalTrips > 0 ? flaggedTrips / totalTrips : 0,
      }
    })
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

    if (filters.routeIntegrity === 'flagged') {
      andWhere.push(this.routeFlaggedCondition() as unknown as WhereOptions<any>)
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
