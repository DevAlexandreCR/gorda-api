import { PrismaClient } from '../../generated/prisma'
import PlaceRepository from '../Repositories/PlaceRepository'

class Container {
  private static prisma: PrismaClient
  private static placeRepository: PlaceRepository

  /**
   * Get or create PrismaClient instance
   */
  static getPrismaClient(): PrismaClient {
    if (!this.prisma) {
      this.prisma = new PrismaClient({
        log: ['error', 'warn'],
        errorFormat: 'pretty',
      })
    }
    return this.prisma
  }

  /**
   * Get or create PlaceRepository instance
   */
  static getPlaceRepository(): PlaceRepository {
    if (!this.placeRepository) {
      this.placeRepository = new PlaceRepository(this.getPrismaClient())
    }
    return this.placeRepository
  }

  /**
   * Cleanup all connections and resources
   */
  static async cleanup(): Promise<void> {
    try {
      if (this.prisma) {
        await this.prisma.$disconnect()
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
      // Test database connection
      await this.getPrismaClient().$connect()
      console.log('Database connected successfully')
    } catch (error) {
      console.error('Database connection failed:', error)
      throw error
    }
  }
}

export default Container
