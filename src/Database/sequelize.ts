import { Sequelize } from 'sequelize'
const config = require('../../config')

const env = config.NODE_ENV || 'development'

const dbConfig = require('./Config/database.js')[env]

const sequelize = new Sequelize(dbConfig.url, {
  dialect: dbConfig.dialect,
  dialectOptions: dbConfig.dialectOptions,
  logging: dbConfig.logging,
  pool: dbConfig.pool
})

export default sequelize
