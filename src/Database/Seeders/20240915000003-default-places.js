'use strict'

const { v4: uuidv4 } = require('uuid')

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('places', [
      {
        id: uuidv4(),
        name: 'Aeropuerto Guillermo León Valencia',
        lat: 2.4544,
        lng: -76.6092,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6092 2.4544)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Parque Caldas',
        lat: 2.4389,
        lng: -76.6131,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6131 2.4389)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Catedral Basílica Nuestra Señora de la Asunción',
        lat: 2.4390,
        lng: -76.6130,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6130 2.4390)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Universidad del Cauca',
        lat: 2.4432,
        lng: -76.6063,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6063 2.4432)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Hospital Universitario San José',
        lat: 2.4444,
        lng: -76.6055,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6055 2.4444)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Centro Comercial Campanario',
        lat: 2.4501,
        lng: -76.6089,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6089 2.4501)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Puente del Humilladero',
        lat: 2.4372,
        lng: -76.6121,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6121 2.4372)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Morro de Tulcán',
        lat: 2.4520,
        lng: -76.6180,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6180 2.4520)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Centro Histórico de Popayán',
        lat: 2.4389,
        lng: -76.6131,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-76.6131 2.4389)', 4326),
        city_id: 'popayan',
        created_at: new Date(),
        updated_at: new Date()
      }
    ], {})
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('places', {
      city_id: 'popayan'
    }, {})
  }
}
