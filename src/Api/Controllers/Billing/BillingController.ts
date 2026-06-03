import { Request, Response, Router } from 'express'
import { requireAuth } from '../../../Middlewares/Authorization'
import Container from '../../../Container/Container'
import EmailService from '../../../Services/email/EmailService'
import { BillingExtra } from '../../../Interfaces/BillingInterface'
import { buildBillingEmailHtml } from './BillingEmailTemplate'

const controller = Router()

controller.use(requireAuth)

controller.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await Container.getBillingRepository().getConfig()
    return res.status(200).json({ success: true, data: config })
  } catch (error) {
    console.error('Error fetching billing config:', error)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

controller.put('/config', async (req: Request, res: Response) => {
  try {
    const { lineCharges, softwareRental } = req.body

    if (!Array.isArray(lineCharges) || typeof softwareRental !== 'number') {
      return res.status(400).json({ success: false, message: 'Invalid payload' })
    }

    await Container.getBillingRepository().upsertLineCharges(lineCharges)
    await Container.getBillingRepository().upsertSoftwareRental(softwareRental)

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Error saving billing config:', error)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

controller.get('/summary', async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month ?? '').trim()

    if (!isValidMonth(month)) {
      return res.status(400).json({ success: false, message: 'month must use YYYY-MM format' })
    }

    const summary = await Container.getBillingRepository().getSummary(month)

    return res.status(200).json({ success: true, data: summary })
  } catch (error) {
    console.error('Error fetching billing summary:', error)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

controller.post('/send', async (req: Request, res: Response) => {
  try {
    const { month, recipientEmail, extras } = req.body as {
      month?: string
      recipientEmail?: string
      extras?: BillingExtra[]
    }

    if (!month || !recipientEmail) {
      return res
        .status(400)
        .json({ success: false, message: 'month and recipientEmail are required' })
    }

    if (!isValidMonth(month)) {
      return res.status(400).json({ success: false, message: 'month must use YYYY-MM format' })
    }

    const normalizedExtras = normalizeExtras(extras)

    const [billingConfig, summary] = await Promise.all([
      Container.getBillingRepository().getConfig(),
      Container.getBillingRepository().getSummary(month),
    ])

    const totalCop =
      billingConfig.lineCharges.reduce((sum, c) => sum + c.amountCop, 0) +
      billingConfig.softwareRental +
      normalizedExtras.reduce((sum, e) => sum + e.amountCop, 0)

    const html = buildBillingEmailHtml({
      summary,
      lineCharges: billingConfig.lineCharges,
      softwareRental: billingConfig.softwareRental,
      extras: normalizedExtras,
      totalCop,
    })

    await EmailService.sendMail({
      to: recipientEmail,
      subject: `Cuenta de cobro ${summary.monthLabel} | Gorda Driver`,
      html,
    })

    return res.status(200).json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error sending billing invoice:', error)
    return res.status(500).json({ success: false, message })
  }
})

function isValidMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false

  const [year, month] = value.split('-').map(Number)

  if (!Number.isInteger(year) || !Number.isInteger(month)) return false
  return month >= 1 && month <= 12
}

function normalizeExtras(extras: BillingExtra[] | undefined): BillingExtra[] {
  if (!Array.isArray(extras)) return []

  return extras.map((extra) => ({
    description: String(extra?.description ?? ''),
    amountCop: Number(extra?.amountCop ?? 0),
  }))
}

export default controller
