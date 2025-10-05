import { QueryInterface, DataTypes } from 'sequelize'

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

    // Index GIN to search in fuzzy text
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS places_name_gin_trgm_idx 
      ON places USING gin (name gin_trgm_ops);
    `)

    // Create additional index for ILIKE searches
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS places_name_ilike_idx 
      ON places USING btree (LOWER(name) text_pattern_ops);
    `)

    // Create function to normalize text (optional but useful)
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION normalize_text(input_text TEXT) 
      RETURNS TEXT AS $$
      BEGIN
        RETURN LOWER(
          TRIM(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(input_text, '[áàäâ]', 'a', 'gi'),
                '[éèëê]', 'e', 'gi'
              ),
              '[íìïî]', 'i', 'gi'
            )
          )
        );
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `)
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS places_name_gin_trgm_idx;')
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS places_name_ilike_idx;')
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS normalize_text(TEXT);')
  }
}