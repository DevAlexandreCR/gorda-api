const path = require("path");
require('dotenv').config({path: path.join(__dirname, '.env')});

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  HOST: process.env.HOST || 'localhost',
  PORT: process.env.PORT || 3000,
  FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || 'http://localhost:9000',
  AUTHENTICATION_EMULATOR_HOST: process.env.AUTHENTICATION_EMULATOR_HOST || 'http://localhost:9099',
  DATABASE_EMULATOR_HOST: process.env.DATABASE_EMULATOR_HOST || 'localhost',
  DATABASE_EMULATOR_PORT: process.env.DATABASE_EMULATOR_PORT || 9000,
  STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST || 'http://localhost:9199',
  DEFAULT_CLIENT_PHOTO_URL: process.env.DEFAULT_CLIENT_PHOTO_URL || 'http://localhost',
  PQR_NUMBER: process.env.PQR_NUMBER || '+573000000000',
  SENTRY_DSN: process.env.SENTRY_DSN || 'http://localhost',
  CHROMIUM_PATH: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser'
}