import { disconnect } from '../db/client.js';
import { dailyRun } from '../tasks/dailyRun.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'run-once' });

function parseTownArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--town='));
  return arg?.slice('--town='.length);
}

const townName = parseTownArg();

dailyRun({ townName })
  .then((summary) => {
    log.info('run-once summary', { townName: townName ?? '(all)', ...summary });
  })
  .catch((err) => {
    log.error('run-once failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
