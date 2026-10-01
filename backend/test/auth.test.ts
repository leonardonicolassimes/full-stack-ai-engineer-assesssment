import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const email = `test-${Date.now()}@example.com`;
let token: string;

beforeAll(async () => {
  await migrate();
  app = await buildApp();
});
afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['test-%@example.com']);
  await app.close();
  await pool.end();
});

describe('auth + extractions access', () => {
  it('registers and returns a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123' } });
    expect(res.statusCode).toBe(201);
    token = res.json().token;
    expect(token).toBeTruthy();
  });

  it('rejects duplicate email', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123' } });
    expect(res.statusCode).toBe(409);
  });

  it('rejects wrong password with generic 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' } });
    expect(res.statusCode).toBe(401);
  });

  it('logs in', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'password123' } });
    expect(res.statusCode).toBe(200);
  });

  it('blocks extractions without token', async () => {
    expect((await app.inject({ url: '/api/extractions' })).statusCode).toBe(401);
  });

  it('lists empty extractions with token', async () => {
    const res = await app.inject({ url: '/api/extractions', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('returns 400 on invalid input', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'bad', password: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});
