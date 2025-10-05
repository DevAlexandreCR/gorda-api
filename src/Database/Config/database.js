const config = require('../../../config')

module.exports = {
  development: {
    url: config.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
      ssl: false,
    },
    logging: console.log,
    pool: {
      max: 20,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
  test: {
    url: config.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
      ssl: false,
    },
    logging: false,
  },
  production: {
    url: config.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    logging: false,
    pool: {
      max: 20,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
}
