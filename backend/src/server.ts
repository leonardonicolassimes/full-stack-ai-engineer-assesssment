import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { startRetentionJob } from './retention.js';

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
startRetentionJob(app.log);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
