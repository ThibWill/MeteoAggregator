import { disconnect } from '../db/client.js';
import { dailyRun } from '../tasks/dailyRun.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'daily' });

dailyRun()
  .then((summary) => {
    log.info('daily run summary', { ...summary });
  })
  .catch((err) => {
    log.error('daily run failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
