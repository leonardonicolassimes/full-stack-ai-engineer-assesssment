import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { audit } from '../audit.js';

const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Stricter limit on credential endpoints to slow brute force.
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', limit, async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email', [
        email,
        hash,
      ]);
      await audit(rows[0].id, 'user.register', rows[0].id);
      return reply.code(201).send({ token: app.jwt.sign({ sub: rows[0].id }), user: rows[0] });
    } catch (err: any) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Email already registered' });
      throw err;
    }
  });

  app.post('/auth/login', limit, async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email=$1', [email]);
    const user = rows[0];
    // Same response for unknown email and wrong password (no user enumeration).
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    await audit(user.id, 'user.login', user.id);
    return { token: app.jwt.sign({ sub: user.id }), user: { id: user.id, email: user.email } };
  });

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query('SELECT id, email FROM users WHERE id=$1', [req.user.sub]);
    return rows[0];
  });
};
