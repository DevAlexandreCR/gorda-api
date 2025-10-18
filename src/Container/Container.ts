import sequelize from '../Database/sequelize'
import PlaceRepository from '../Repositories/PlaceRepository'
import PlaceSearchRepository from '../Repositories/PlaceSearchRepository'

class Container {
  private static sequelizeInstance: typeof sequelize
  private static placeRepository: PlaceRepository
  private static placeSearchRepository: PlaceSearchRepository

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
      await this.getSequelize().sync({ alter: true })
      console.log('Database connected and models synchronized successfully')
    } catch (error) {
      console.error('Database connection failed:', error)
      throw error
    }
  }
}

export default Container
