// Runs before test files are imported. CI has no `.env`, so a dummy
// DB_URL keeps ConfigModule.forRoot() from throwing if AppModule is
// loaded before the testcontainer URI is ready. startTestDb() overwrites it.
const { generateKeyPairSync } = require('node:crypto');

process.env.DB_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
  const pair = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = Buffer.from(pair.privateKey).toString('base64');
  process.env.JWT_PUBLIC_KEY = Buffer.from(pair.publicKey).toString('base64');
}
process.env.JWT_KID ??= 'test';
process.env.REFRESH_TOKEN_PEPPER ??= 'test-refresh-pepper';
