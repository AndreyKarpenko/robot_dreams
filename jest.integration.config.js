module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  reporters: ['default'],
  maxWorkers: 1,
  testTimeout: 120000,
  setupFiles: ['reflect-metadata'],
};
