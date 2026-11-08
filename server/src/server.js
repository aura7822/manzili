import { createApp } from './app.js';
import { assertConfig, config } from './config.js';
import { ensureDefaultAdmin, migrateDatabase, pool } from './db.js';
import { startJobs } from './jobs.js';

async function bootstrap() {
  assertConfig();
  await migrateDatabase();
  await ensureDefaultAdmin();

  if (!config.disableJobs) {
    startJobs();
  }

  const app = createApp();
  const port = config.port;

  const server = app.listen(port, () => {
    console.log(`Rent Manager API listening on http://localhost:${port}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
