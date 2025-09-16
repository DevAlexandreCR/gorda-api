import { Sequelize } from 'sequelize'
const config = require('../../config')

// Get the current environment
const env = process.env.NODE_ENV || 'development'

// Import database configuration
const dbConfig = require('./Config/database.js')[env]

// Create Sequelize instance
const sequelize = new Sequelize(dbConfig.url || dbConfig.database, dbConfig.username, dbConfig.password, {
  host: dbConfig.host,
  port: dbConfig.port,
  dialect: dbConfig.dialect,
  dialectOptions: dbConfig.dialectOptions,
  logging: dbConfig.logging,
  pool: dbConfig.pool
})

export default sequelize
