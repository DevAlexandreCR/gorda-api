import { Request, Response, Router } from 'express'
import Container from '../../../Container/Container'
import config from '../../../../config'
import { getAdminVersionPolicy } from '../../../Helpers/VersionPolicy'

const controller = Router()

controller.get('/ride-fees/snapshot', async (_req: Request, res: Response) => {
  try {
    const rideFees = await Container.getMasterDataRepository().buildPricingSnapshot()

    return res.status(200).json({
      success: true,
      data: { rideFees },
    })
  } catch (error) {
    console.error('Error building pricing snapshot:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/version-policy', async (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    data: {
      versionPolicy: {
        admin: getAdminVersionPolicy(),
        driver: {
          minVersionCode: config.DRIVER_MIN_VERSION_CODE,
        },
      },
    },
  })
})

controller.get('/wp-clients/:id', async (req: Request, res: Response) => {
  try {
    const client = await Container.getMasterDataRepository().findWpClient(req.params.id)
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { client },
    })
  } catch (error) {
    console.error('Error fetching wp client:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

controller.get('/branches/:branchId/cities/:cityId', async (req: Request, res: Response) => {
  try {
    const city = await Container.getMasterDataRepository().getCity(
      req.params.branchId,
      req.params.cityId
    )

    if (!city) {
      return res.status(404).json({
        success: false,
        message: 'City not found',
        data: {},
      })
    }

    return res.status(200).json({
      success: true,
      data: { city },
    })
  } catch (error) {
    console.error('Error fetching city settings:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
})

export default controller
