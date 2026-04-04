import { Op } from 'sequelize'
import DriverTokenRecord from '../Models/DriverTokenRecord'
import { DriverTokenInterface } from '../Interfaces/DriverTokenInterface'

class DriverTokenRecordRepository {
  async upsert(driverId: string, token: string): Promise<DriverTokenInterface> {
    await DriverTokenRecord.destroy({
      where: {
        token,
        driver_id: {
          [Op.ne]: driverId,
        },
      },
    })

    const [driverToken] = await DriverTokenRecord.upsert(
      {
        driver_id: driverId,
        token,
      },
      { returning: true }
    )

    return driverToken.get({ plain: true }) as DriverTokenInterface
  }

  async findByToken(token: string): Promise<DriverTokenInterface | null> {
    const driverToken = await DriverTokenRecord.findOne({
      where: { token },
    })

    return driverToken ? (driverToken.get({ plain: true }) as DriverTokenInterface) : null
  }

  async findByDriverId(driverId: string): Promise<DriverTokenInterface | null> {
    const driverToken = await DriverTokenRecord.findByPk(driverId)
    return driverToken ? (driverToken.get({ plain: true }) as DriverTokenInterface) : null
  }

  async deleteByDriverId(driverId: string): Promise<boolean> {
    const deletedRows = await DriverTokenRecord.destroy({
      where: { driver_id: driverId },
    })

    return deletedRows > 0
  }
}

export default DriverTokenRecordRepository
