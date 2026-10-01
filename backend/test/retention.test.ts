import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { purgeExpired } from '../src/extractions/repo.js';

let userId: string;
beforeAll(async () => {
  await migrate();
  userId = (await pool.query("INSERT INTO users (email, password_hash) VALUES ($1,'x') RETURNING id", [`test-ret-${Date.now()}@example.com`])).rows[0].id;
});
afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
});

describe('retention', () => {
  it('deletes only expired rows', async () => {
    const ins = (expires: string) =>
      pool.query("INSERT INTO extractions (user_id, input_text, input_hash, expires_at) VALUES ($1,'t','h',$2) RETURNING id", [userId, expires]);
    const old = (await ins(new Date(Date.now() - 86400000).toISOString())).rows[0].id;
    const fresh = (await ins(new Date(Date.now() + 86400000).toISOString())).rows[0].id;
    expect(await purgeExpired()).toBeGreaterThanOrEqual(1);
    const left = (await pool.query('SELECT id FROM extractions WHERE id = ANY($1)', [[old, fresh]])).rows.map((r) => r.id);
    expect(left).toEqual([fresh]);
  });
});
