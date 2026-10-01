import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { audit } from '../audit.js';

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const COLUMNS = `id, parent_id, status, input_text, instruction, result, error, prompt_version,
  model, tokens_in, tokens_out, cost_usd, latency_ms, feedback, created_at`;

export const extractionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/extractions', async (req) => {
    const { limit, offset } = listQuery.parse(req.query);
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM extractions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.sub, limit, offset],
    );
    return { items: rows, limit, offset };
  });

  app.get('/extractions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM extractions WHERE id=$1 AND user_id=$2`, [
      id,
      req.user.sub,
    ]);
    return rows[0] ?? reply.code(404).send({ error: 'Not found' });
  });

  app.delete('/extractions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { rowCount } = await pool.query('DELETE FROM extractions WHERE id=$1 AND user_id=$2', [id, req.user.sub]);
    if (!rowCount) return reply.code(404).send({ error: 'Not found' });
    await audit(req.user.sub, 'extraction.delete', id);
    return reply.code(204).send();
  });

  app.post('/extractions/:id/feedback', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { value } = z.object({ value: z.union([z.literal(1), z.literal(-1)]) }).parse(req.body);
    const { rowCount } = await pool.query('UPDATE extractions SET feedback=$1 WHERE id=$2 AND user_id=$3', [
      value,
      id,
      req.user.sub,
    ]);
    if (!rowCount) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });
};
