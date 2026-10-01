import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './errors.js';
import { authRoutes } from './auth/routes.js';
import { extractionRoutes } from './extractions/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function buildApp() {
  const app = Fastify({
    // Request bodies are never logged: they contain user content (potential PII).
    logger: config.NODE_ENV === 'test' ? false : { redact: ['req.headers.authorization'] },
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_EXPIRES_IN } });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: err.issues });
    }
    // AppError messages are written to be client-safe (no provider internals).
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(extractionRoutes, { prefix: '/api' });
  return app;
}
