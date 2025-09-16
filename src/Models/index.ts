import sequelize from '../Database/sequelize'
import Branch from './Branch'
import City from './City'
import Place from './Place'

// Export models
export { Branch, City, Place }

// Initialize all models and associations
export const initializeModels = async () => {
  try {
    // Test connection
    await sequelize.authenticate()
    console.log('Database connection established successfully.')

    // Sync models (create tables if they don't exist)
    await sequelize.sync({ alter: true })
    console.log('Database models synchronized.')

    return sequelize
  } catch (error) {
    console.error('Unable to connect to the database:', error)
    throw error
  }
}

export default sequelize
