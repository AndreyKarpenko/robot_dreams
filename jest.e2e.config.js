module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  reporters: ['default'],
  maxWorkers: 1,
  testTimeout: 120000,
  setupFiles: ['reflect-metadata', '<rootDir>/test/jest-env-setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(@nestjs/config|dotenv-expand|es-toolkit)/)',
  ],
};
