import { loadEnv } from '../config/env.js';
import { disconnect } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { buildServer } from './server.js';
import { beginShutdown } from './services/jobs.js';

const log = logger.child({ app: 'api' });

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    // Stops new job triggers being accepted while in-flight requests drain.
    beginShutdown();
    log.info('shutting down', { signal });
    void app
      .close()
      .then(() => disconnect())
      .then(() => {
        log.info('shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        log.error('shutdown failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  log.info('api listening', {
    port: env.API_PORT,
    host: env.API_HOST,
    docs: `http://localhost:${env.API_PORT}/docs`,
    admin: env.API_ENABLE_ADMIN,
  });
}

main().catch((err) => {
  log.error('api failed to start', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
  void disconnect();
});
