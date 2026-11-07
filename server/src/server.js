import { createApp } from './app.js';
import { assertConfig, config } from './config.js';
import { ensureDefaultAdmin, migrateDatabase, pool } from './db.js';
import { startJobs } from './jobs.js';

assertConfig();
await migrateDatabase();
await ensureDefaultAdmin();

const app = createApp();
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Rent Manager API listening on http://localhost:${PORT}`);
  if (!config.disableJobs) startJobs();
});

const shutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
