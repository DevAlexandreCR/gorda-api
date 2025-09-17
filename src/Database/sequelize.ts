import { Sequelize } from 'sequelize'
const config = require('../../config')

// Force process to use UTC timezone globally
process.env.TZ = 'UTC'

const env = config.NODE_ENV || 'development'

const dbConfig = require('./Config/database.js')[env]

const sequelize = new Sequelize(dbConfig.url, {
  dialect: dbConfig.dialect,
  dialectOptions: dbConfig.dialectOptions,
  logging: dbConfig.logging,
  pool: dbConfig.pool,
  timezone: '+00:00' // Force UTC timezone for database operations
})

export default sequelize
