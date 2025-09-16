import { Sequelize } from 'sequelize'
import * as dotenv from 'dotenv'
import config from '../../config'

dotenv.config()

const sequelize = new Sequelize(config.DATABASE_URL!, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  },
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 20,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
})

export default sequelize
