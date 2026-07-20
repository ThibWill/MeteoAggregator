import fp from 'fastify-plugin';

/**
 * Authentication extension point. The API is currently unauthenticated and
 * meant for a private network (see PLAN_API §2). When it leaves that network,
 * implement the check here — this hook already runs on every route, so wiring a
 * real credential check is a one-file change.
 */
export const authPlugin = fp(async (app) => {
  app.addHook('preHandler', async (_req, _reply) => {
    // No-op: no authentication yet.
  });
});
