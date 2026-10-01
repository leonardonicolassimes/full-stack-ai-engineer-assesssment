import { pool } from './db/pool.js';

export async function audit(userId: string | null, action: string, entityId?: string, meta: object = {}) {
  await pool.query('INSERT INTO audit_log (user_id, action, entity_id, meta) VALUES ($1,$2,$3,$4)', [
    userId,
    action,
    entityId ?? null,
    meta,
  ]);
}
