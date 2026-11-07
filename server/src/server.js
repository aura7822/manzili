import { createApp } from './app.js';
import { assertConfig, config } from './config.js';
import { pool } from './db.js';
import { startJobs } from './jobs.js';

assertConfig();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Rent Manager API listening on http://localhost:${config.port}`);
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
