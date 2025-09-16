import sequelize from '../Config/database'
import PlaceRepository from '../Repositories/PlaceRepository'

class Container {
  private static sequelizeInstance: typeof sequelize
  private static placeRepository: PlaceRepository

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
