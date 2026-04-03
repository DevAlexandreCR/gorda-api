import sequelize from '../Database/sequelize'
import PlaceRepository from '../Repositories/PlaceRepository'
import PlaceSearchRepository from '../Repositories/PlaceSearchRepository'
import ClientRepository from '../Repositories/ClientRepository'
import MasterDataRepository from '../Repositories/MasterDataRepository'
import UserRecordRepository from '../Repositories/UserRecordRepository'
import DriverRecordRepository from '../Repositories/DriverRecordRepository'

class Container {
  private static sequelizeInstance: typeof sequelize
  private static placeRepository: PlaceRepository
  private static placeSearchRepository: PlaceSearchRepository
  private static clientRepository: ClientRepository
  private static masterDataRepository: MasterDataRepository
  private static userRecordRepository: UserRecordRepository
  private static driverRecordRepository: DriverRecordRepository

  /**
   * Get or create Sequelize instance
   */
  static getSequelize(): typeof sequelize {
    if (!this.sequelizeInstance) {
      this.sequelizeInstance = sequelize
    }
    return this.sequelizeInstance
  }

  /**
   * Get or create PlaceRepository instance
   */
  static getPlaceRepository(): PlaceRepository {
    if (!this.placeRepository) {
      this.placeRepository = new PlaceRepository(this.getSequelize())
    }
    return this.placeRepository
  }

  /**
   * Get or create PlaceSearchRepository instance
   */
  static getPlaceSearchRepository(): PlaceSearchRepository {
    if (!this.placeSearchRepository) {
      this.placeSearchRepository = new PlaceSearchRepository(this.getSequelize())
    }
    return this.placeSearchRepository
  }

  /**
   * Get or create ClientRepository instance
   */
  static getClientRepository(): ClientRepository {
    if (!this.clientRepository) {
      this.clientRepository = new ClientRepository(this.getSequelize())
    }
    return this.clientRepository
  }

  static getMasterDataRepository(): MasterDataRepository {
    if (!this.masterDataRepository) {
      this.masterDataRepository = new MasterDataRepository(this.getSequelize())
    }
    return this.masterDataRepository
  }

  static getUserRecordRepository(): UserRecordRepository {
    if (!this.userRecordRepository) {
      this.userRecordRepository = new UserRecordRepository()
    }
    return this.userRecordRepository
  }

  static getDriverRecordRepository(): DriverRecordRepository {
    if (!this.driverRecordRepository) {
      this.driverRecordRepository = new DriverRecordRepository()
    }
    return this.driverRecordRepository
  }

  /**
   * Cleanup all connections and resources
   */
  static async cleanup(): Promise<void> {
    try {
      if (this.sequelizeInstance) {
        await this.sequelizeInstance.close()
        console.log('Database connections closed')
      }
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
  }

  /**
   * Initialize container on app startup
   */
  static async initialize(): Promise<void> {
    try {
      // Test database connection and sync models
      await this.getSequelize().authenticate()
      if (process.env.NODE_ENV !== 'production') {
        await this.getSequelize().sync({ alter: true })
        console.log('Database connected and models synchronized successfully')
      } else {
        console.log('Database connected successfully (production mode, sync skipped)')
      }
    } catch (error) {
      console.error('Database connection failed:', error)
      throw error
    }
  }
}

export default Container
