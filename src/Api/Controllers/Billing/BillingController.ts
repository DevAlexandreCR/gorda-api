import { Request, Response, Router } from 'express'
import dayjs from 'dayjs'
import { requireAuth } from '../../../Middlewares/Authorization'
import Container from '../../../Container/Container'
import EmailService from '../../../Services/email/EmailService'
import { BillingExtra } from '../../../Interfaces/BillingInterface'

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

controller.post('/send', async (req: Request, res: Response) => {
  try {
    const { month, recipientEmail, extras } = req.body as {
      month?: string
      recipientEmail?: string
      extras?: BillingExtra[]
    }

    if (!month || !recipientEmail) {
      return res.status(400).json({ success: false, message: 'month and recipientEmail are required' })
    }

    const startDate = dayjs(`${month}-01`).format('YYYY-MM-DD')
    const endDate = dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD')

    const [billingConfig, metrics] = await Promise.all([
      Container.getBillingRepository().getConfig(),
      Container.getServiceMetricsDailyRepository().listGlobal(startDate, endDate),
    ])

    const totalServices = metrics.reduce((sum, m) => sum + m.count, 0)
    const completedServices = metrics
      .filter((m) => m.status === 'terminated')
      .reduce((sum, m) => sum + m.count, 0)
    const canceledServices = metrics
      .filter((m) => m.status === 'canceled')
      .reduce((sum, m) => sum + m.count, 0)
    const cancelPercent =
      totalServices > 0 ? ((canceledServices / totalServices) * 100).toFixed(1) : '0.0'
    const completePercent =
      totalServices > 0 ? ((completedServices / totalServices) * 100).toFixed(1) : '0.0'

    const monthName = dayjs(`${month}-01`).format('MMMM YYYY').toUpperCase()

    const extrasList = (extras ?? []).map((e) => `<tr><td>${e.description}</td><td style="text-align:right">${formatCop(e.amountCop)}</td></tr>`).join('')

    const totalCop =
      billingConfig.lineCharges.reduce((sum, c) => sum + c.amountCop, 0) +
      billingConfig.softwareRental +
      (extras ?? []).reduce((sum, e) => sum + e.amountCop, 0)

    const lineChargesRows = billingConfig.lineCharges
      .map((c) => `<tr><td>${c.alias}</td><td style="text-align:right">${formatCop(c.amountCop)}</td></tr>`)
      .join('')

    const html = buildEmailHtml({
      monthName,
      totalServices,
      completedServices,
      completePercent,
      canceledServices,
      cancelPercent,
      lineChargesRows,
      softwareRental: billingConfig.softwareRental,
      extrasList,
      totalCop,
    })

    await EmailService.sendMail({
      to: recipientEmail,
      subject: `Cuenta de cobro ${monthName} — Gorda Driver`,
      html,
    })

    return res.status(200).json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error sending billing invoice:', error)
    return res.status(500).json({ success: false, message })
  }
})

function formatCop(amount: number): string {
  return `$${amount.toLocaleString('es-CO')} COP`
}

function buildEmailHtml(params: {
  monthName: string
  totalServices: number
  completedServices: number
  completePercent: string
  canceledServices: number
  cancelPercent: string
  lineChargesRows: string
  softwareRental: number
  extrasList: string
  totalCop: number
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#333">
  <h2 style="text-align:center">RESUMEN ${params.monthName} — Gorda Driver</h2>
  <h3>MÉTRICAS DEL MES</h3>
  <table width="100%" cellpadding="6" style="border-collapse:collapse">
    <tr><td>Total servicios</td><td style="text-align:right">${params.totalServices}</td></tr>
    <tr><td>Completados</td><td style="text-align:right">${params.completedServices} (${params.completePercent}%)</td></tr>
    <tr><td>Cancelados</td><td style="text-align:right">${params.canceledServices} (${params.cancelPercent}%)</td></tr>
  </table>
  <h3>COBROS</h3>
  <table width="100%" cellpadding="6" style="border-collapse:collapse">
    ${params.lineChargesRows}
    <tr><td>Software rental</td><td style="text-align:right">${formatCop(params.softwareRental)}</td></tr>
    ${params.extrasList}
    <tr><td colspan="2"><hr></td></tr>
    <tr><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>${formatCop(params.totalCop)}</strong></td></tr>
  </table>
  <p style="color:#888;font-size:12px;margin-top:32px">Este correo fue generado automáticamente.</p>
</body>
</html>`
}

export default controller
