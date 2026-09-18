module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/contract/verify-provider.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  reporters: ['default'],
  maxWorkers: 1,
  testTimeout: 180000,
  setupFiles: ['reflect-metadata'],
  transformIgnorePatterns: [
    'node_modules/(?!(@nestjs/config|dotenv-expand|es-toolkit)/)',
  ],
};
