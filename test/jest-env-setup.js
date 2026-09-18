// Runs before test files are imported. CI has no `.env`, so a dummy
// DB_URL keeps ConfigModule.forRoot() from throwing if AppModule is
// loaded before the testcontainer URI is ready. startTestDb() overwrites it.
process.env.DB_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
