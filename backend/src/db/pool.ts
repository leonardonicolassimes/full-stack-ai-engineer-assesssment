import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // RDS enforces TLS. Trade-off: traffic is encrypted but the server cert is not verified;
  // production should bundle the RDS CA and set rejectUnauthorized: true.
  ssl: config.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
