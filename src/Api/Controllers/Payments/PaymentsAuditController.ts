import { Request, Response, Router } from 'express'
import Container from '../../../Container/Container'
import { requireAuth } from '../../../Middlewares/Authorization'
import { PERIOD_FORMAT } from '../../../Services/time/BogotaTime'
import {
  MonthlyPaymentsAuditQuery,
  PaymentsAuditQuery,
  RechargesAuditQuery,
} from '../../../Interfaces/PaymentsAuditInterface'

const controller = Router()

controller.use(requireAuth)

const DATE_FORMAT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PER_PAGE_ALLOWED = [20, 50, 100]
const STATUS_ALLOWED = ['active', 'voided']
const MONTHLY_ANOMALY_ALLOWED = ['duplicate', 'atypical', 'outOfPeriod', 'voided']
const RECHARGE_ANOMALY_ALLOWED = ['duplicate', 'atypical']
const MONTHLY_SORT_WHITELIST = ['created_at', 'amount', 'period', 'driver_name']
const RECHARGE_SORT_WHITELIST = ['created_at', 'amount', 'driver_name']
const SUMMARY_SORT_WHITELIST = ['driver_name', 'active_amount', 'payment_count', 'last_created_at']

type CommonQueryValue = Pick<
  PaymentsAuditQuery,
  'period' | 'createdFrom' | 'createdTo' | 'driverSearch' | 'driverId' | 'createdByUid' | 'page' | 'perPage'
>

type Validated<T> = { value: T } | { error: string }

function badRequest(res: Response, message: string) {
  return res.status(400).json({ success: false, message, data: {} })
}

function internalError(res: Response, context: string, error: unknown) {
  console.error(context, error)
  return res.status(500).json({ success: false, message: 'Internal server error', data: {} })
}

function stringParam(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  const value = String(raw)
  return value === '' ? undefined : value
}

function parseCommonQuery(req: Request): Validated<CommonQueryValue> {
  const period = stringParam(req.query.period)
  if (period !== undefined && !PERIOD_FORMAT.test(period)) {
    return { error: 'period must match the format YYYY-MM' }
  }

  const createdFrom = stringParam(req.query.createdFrom)
  if (createdFrom !== undefined && !DATE_FORMAT.test(createdFrom)) {
    return { error: 'createdFrom must match the format YYYY-MM-DD' }
  }

  const createdTo = stringParam(req.query.createdTo)
  if (createdTo !== undefined && !DATE_FORMAT.test(createdTo)) {
    return { error: 'createdTo must match the format YYYY-MM-DD' }
  }

  if (createdFrom !== undefined && createdTo !== undefined && createdFrom > createdTo) {
    return { error: 'createdFrom must not be later than createdTo' }
  }

  let perPage = 50
  if (req.query.perPage !== undefined) {
    perPage = Number(req.query.perPage)
    if (!PER_PAGE_ALLOWED.includes(perPage)) {
      return { error: `Invalid perPage value. Allowed values: ${PER_PAGE_ALLOWED.join(', ')}` }
    }
  }

  let page = 1
  if (req.query.page !== undefined) {
    page = Number(req.query.page)
    if (!Number.isInteger(page) || page < 1) {
      return { error: 'page must be an integer >= 1' }
    }
  }

  return {
    value: {
      period,
      createdFrom,
      createdTo,
      driverSearch: stringParam(req.query.driverSearch),
      driverId: stringParam(req.query.driverId),
      createdByUid: stringParam(req.query.createdByUid),
      page,
      perPage,
    },
  }
}

function parseAnomaly(raw: unknown, allowed: string[]): Validated<string[] | undefined> {
  const str = stringParam(raw)
  if (str === undefined) return { value: undefined }

  const values = str
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)

  const invalid = values.find((v) => !allowed.includes(v))
  if (invalid !== undefined) {
    return { error: `Invalid anomaly value: "${invalid}". Allowed values: ${allowed.join(', ')}` }
  }

  return { value: values.length > 0 ? values : undefined }
}

function parseSort(raw: unknown, whitelist: string[], defaultSort: string): Validated<string> {
  const sortRaw = stringParam(raw) ?? defaultSort
  const field = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw
  if (!whitelist.includes(field)) {
    return { error: `Invalid sort field: "${field}". Allowed: ${whitelist.join(', ')}` }
  }
  return { value: sortRaw }
}

function parseStatus(raw: unknown): Validated<'active' | 'voided' | undefined> {
  const str = stringParam(raw)
  if (str === undefined) return { value: undefined }
  if (!STATUS_ALLOWED.includes(str)) {
    return { error: `Invalid status value. Allowed values: ${STATUS_ALLOWED.join(', ')}` }
  }
  return { value: str as 'active' | 'voided' }
}

function parseAmountThreshold(raw: unknown): Validated<number | undefined> {
  const str = stringParam(raw)
  if (str === undefined) return { value: undefined }
  const num = Number(str)
  if (!Number.isFinite(num) || num <= 0) {
    return { error: 'amountThreshold must be a number greater than 0' }
  }
  return { value: num }
}

function parseAmountBound(raw: unknown, name: string): Validated<number | undefined> {
  const str = stringParam(raw)
  if (str === undefined) return { value: undefined }
  const num = Number(str)
  if (!Number.isFinite(num)) {
    return { error: `${name} must be a number` }
  }
  return { value: num }
}

controller.get('/monthly', async (req: Request, res: Response) => {
  try {
    const common = parseCommonQuery(req)
    if ('error' in common) return badRequest(res, common.error)

    const anomaly = parseAnomaly(req.query.anomaly, MONTHLY_ANOMALY_ALLOWED)
    if ('error' in anomaly) return badRequest(res, anomaly.error)

    const sort = parseSort(req.query.sort, MONTHLY_SORT_WHITELIST, '-created_at')
    if ('error' in sort) return badRequest(res, sort.error)

    const status = parseStatus(req.query.status)
    if ('error' in status) return badRequest(res, status.error)

    const amountThreshold = parseAmountThreshold(req.query.amountThreshold)
    if ('error' in amountThreshold) return badRequest(res, amountThreshold.error)

    const query: MonthlyPaymentsAuditQuery = {
      ...common.value,
      anomaly: anomaly.value,
      sort: sort.value,
      status: status.value,
      amountThreshold: amountThreshold.value,
    }

    const result = await Container.getPaymentsAuditRepository().listMonthly(query)
    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    return internalError(res, 'Error fetching monthly payments audit:', error)
  }
})

controller.get('/monthly/summary', async (req: Request, res: Response) => {
  try {
    const common = parseCommonQuery(req)
    if ('error' in common) return badRequest(res, common.error)

    const anomaly = parseAnomaly(req.query.anomaly, MONTHLY_ANOMALY_ALLOWED)
    if ('error' in anomaly) return badRequest(res, anomaly.error)

    const sort = parseSort(req.query.sort, SUMMARY_SORT_WHITELIST, '-active_amount')
    if ('error' in sort) return badRequest(res, sort.error)

    const status = parseStatus(req.query.status)
    if ('error' in status) return badRequest(res, status.error)

    const amountThreshold = parseAmountThreshold(req.query.amountThreshold)
    if ('error' in amountThreshold) return badRequest(res, amountThreshold.error)

    const query: MonthlyPaymentsAuditQuery = {
      ...common.value,
      anomaly: anomaly.value,
      sort: sort.value,
      status: status.value,
      amountThreshold: amountThreshold.value,
    }

    const result = await Container.getPaymentsAuditRepository().summaryMonthly(query)
    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    return internalError(res, 'Error fetching monthly payments audit summary:', error)
  }
})

controller.get('/recharges', async (req: Request, res: Response) => {
  try {
    if (req.query.status !== undefined) {
      return badRequest(res, 'status is not a valid parameter for this endpoint')
    }
    if (req.query.amountThreshold !== undefined) {
      return badRequest(res, 'amountThreshold is not a valid parameter for this endpoint')
    }

    const common = parseCommonQuery(req)
    if ('error' in common) return badRequest(res, common.error)

    const anomaly = parseAnomaly(req.query.anomaly, RECHARGE_ANOMALY_ALLOWED)
    if ('error' in anomaly) return badRequest(res, anomaly.error)

    const sort = parseSort(req.query.sort, RECHARGE_SORT_WHITELIST, '-created_at')
    if ('error' in sort) return badRequest(res, sort.error)

    const minAmount = parseAmountBound(req.query.minAmount, 'minAmount')
    if ('error' in minAmount) return badRequest(res, minAmount.error)

    const maxAmount = parseAmountBound(req.query.maxAmount, 'maxAmount')
    if ('error' in maxAmount) return badRequest(res, maxAmount.error)

    if (minAmount.value !== undefined && maxAmount.value !== undefined && minAmount.value > maxAmount.value) {
      return badRequest(res, 'minAmount must not be greater than maxAmount')
    }

    const query: RechargesAuditQuery = {
      ...common.value,
      anomaly: anomaly.value,
      sort: sort.value,
      minAmount: minAmount.value,
      maxAmount: maxAmount.value,
    }

    const result = await Container.getPaymentsAuditRepository().listRecharges(query)
    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    return internalError(res, 'Error fetching recharges audit:', error)
  }
})

controller.get('/recharges/summary', async (req: Request, res: Response) => {
  try {
    if (req.query.status !== undefined) {
      return badRequest(res, 'status is not a valid parameter for this endpoint')
    }
    if (req.query.amountThreshold !== undefined) {
      return badRequest(res, 'amountThreshold is not a valid parameter for this endpoint')
    }

    const common = parseCommonQuery(req)
    if ('error' in common) return badRequest(res, common.error)

    const anomaly = parseAnomaly(req.query.anomaly, RECHARGE_ANOMALY_ALLOWED)
    if ('error' in anomaly) return badRequest(res, anomaly.error)

    const sort = parseSort(req.query.sort, SUMMARY_SORT_WHITELIST, '-active_amount')
    if ('error' in sort) return badRequest(res, sort.error)

    const minAmount = parseAmountBound(req.query.minAmount, 'minAmount')
    if ('error' in minAmount) return badRequest(res, minAmount.error)

    const maxAmount = parseAmountBound(req.query.maxAmount, 'maxAmount')
    if ('error' in maxAmount) return badRequest(res, maxAmount.error)

    if (minAmount.value !== undefined && maxAmount.value !== undefined && minAmount.value > maxAmount.value) {
      return badRequest(res, 'minAmount must not be greater than maxAmount')
    }

    const query: RechargesAuditQuery = {
      ...common.value,
      anomaly: anomaly.value,
      sort: sort.value,
      minAmount: minAmount.value,
      maxAmount: maxAmount.value,
    }

    const result = await Container.getPaymentsAuditRepository().summaryRecharges(query)
    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    return internalError(res, 'Error fetching recharges audit summary:', error)
  }
})

controller.get('/actors', async (req: Request, res: Response) => {
  try {
    const type = stringParam(req.query.type)
    if (type !== 'monthly' && type !== 'recharges') {
      return badRequest(res, 'type must be "monthly" or "recharges"')
    }

    const actors = await Container.getPaymentsAuditRepository().listActors(type)
    return res.status(200).json({ success: true, data: { actors } })
  } catch (error) {
    return internalError(res, 'Error fetching payments audit actors:', error)
  }
})

export default controller
