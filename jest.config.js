/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleNameMapper: {
    '^Services/(.*)$': '<rootDir>/src/Services/$1',
    '^Helpers/(.*)$': '<rootDir>/src/Helpers/$1',
  },
}
