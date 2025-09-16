'use strict'

const { v4: uuidv4 } = require('uuid')

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('places', [
      {
        id: uuidv4(),
        name: 'Aeropuerto Juan Santamaría',
        lat: 9.993889,
        lng: -84.208889,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.208889 9.993889)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Teatro Nacional',
        lat: 9.932597,
        lng: -84.078155,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.078155 9.932597)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Hospital Calderón Guardia',
        lat: 9.940278,
        lng: -84.077778,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.077778 9.940278)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Universidad de Costa Rica',
        lat: 9.937222,
        lng: -84.051944,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.051944 9.937222)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Mercado Central',
        lat: 9.933611,
        lng: -84.079167,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.079167 9.933611)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Mall San Pedro',
        lat: 9.929444,
        lng: -84.051111,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.051111 9.929444)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Estadio Nacional',
        lat: 9.935,
        lng: -84.098333,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.098333 9.935)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: uuidv4(),
        name: 'Parque La Sabana',
        lat: 9.936111,
        lng: -84.102222,
        location: queryInterface.sequelize.fn('ST_GeomFromText', 'POINT(-84.102222 9.936111)', 4326),
        city_id: 'SAN_JOSE_001',
        created_at: new Date(),
        updated_at: new Date()
      }
    ], {})
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('places', {
      city_id: 'SAN_JOSE_001'
    }, {})
  }
}
