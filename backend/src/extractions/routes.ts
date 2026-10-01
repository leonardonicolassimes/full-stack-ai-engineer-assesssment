import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { audit } from '../audit.js';
import { AppError } from '../errors.js';
import { COLUMNS, findOwned } from './repo.js';
import { runExtraction } from './service.js';

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const createBody = z
  .object({
    text: z.string().optional(),
    instruction: z.string().optional(),
    parentId: z.string().uuid().optional(),
  })
  .refine((b) => b.text || b.parentId, { message: 'text or parentId is required' });

export const extractionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // AI endpoints are the expensive ones: rate-limit per *user*, not per IP.
  const aiLimit = {
    config: {
      rateLimit: {
        max: config.USER_RATE_LIMIT_PER_MIN,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => {
          try {
            return `u:${(app.jwt.verify(req.headers.authorization?.replace(/^Bearer /, '') ?? '') as { sub: string }).sub}`;
          } catch {
            return req.ip;
          }
        },
      },
    },
  };

  app.post('/extractions', aiLimit, async (req, reply) => {
    const body = createBody.parse(req.body);
    const ac = new AbortController();
    // Client went away before we finished: stop paying for tokens.
    reply.raw.on('close', () => !reply.raw.writableFinished && ac.abort());
    const { extraction, cached, warnings } = await runExtraction({ userId: req.user.sub, ...body }, { signal: ac.signal });
    return reply.code(cached ? 200 : 201).send({ extraction, cached, warnings });
  });

  // Server-Sent Events: status -> delta* -> result | error.
  app.post('/extractions/stream', aiLimit, async (req, reply) => {
    const body = createBody.parse(req.body);
    const ac = new AbortController();
    reply.raw.on('close', () => ac.abort());

    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>), // keeps CORS / security headers
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (e: { type: string }) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await runExtraction({ userId: req.user.sub, ...body }, { emit: send, signal: ac.signal });
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Internal server error';
      if (!(err instanceof AppError)) app.log.error(err);
      send({ type: 'error', message } as any);
    } finally {
      reply.raw.end();
    }
  });

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
    return (await findOwned(req.user.sub, id)) ?? reply.code(404).send({ error: 'Not found' });
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
