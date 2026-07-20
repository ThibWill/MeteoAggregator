import fp from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/** Exposes the existing singleton; deliberately does not create a second client. */
export const prismaPlugin = fp(async (app) => {
  app.decorate('prisma', prisma);
});
