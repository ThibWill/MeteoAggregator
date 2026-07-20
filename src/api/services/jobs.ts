import { randomUUID } from 'node:crypto';
import { conflict } from '../errors.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ app: 'api', component: 'jobs' });

export type JobType = 'daily-run' | 'backfill-observations';
export type JobStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  params: Record<string, unknown>;
  result: unknown;
  error: string | null;
}

/**
 * Deliberately in-memory and lost on restart (PLAN_API §6.7): the `report`
 * table stays the durable record of what ran. Not a job queue.
 */
const jobs = new Map<string, JobRecord>();
const running = new Map<JobType, string>();
let shuttingDown = false;

const MAX_JOBS = 200;

/** Called on SIGTERM/SIGINT so a draining process refuses new work. */
export function beginShutdown(): void {
  shuttingDown = true;
}

export function resetJobs(): void {
  jobs.clear();
  running.clear();
  shuttingDown = false;
}

function prune(): void {
  if (jobs.size <= MAX_JOBS) return;
  const ordered = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const j of ordered.slice(0, jobs.size - MAX_JOBS)) {
    if (j.status !== 'RUNNING') jobs.delete(j.id);
  }
}

export function startJob(
  type: JobType,
  params: Record<string, unknown>,
  run: () => Promise<unknown>,
): JobRecord {
  if (shuttingDown) throw conflict('server is shutting down; not accepting new jobs');
  const active = running.get(type);
  if (active !== undefined) {
    throw conflict(`a ${type} job is already running (id ${active})`);
  }

  const record: JobRecord = {
    id: randomUUID(),
    type,
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    params,
    result: null,
    error: null,
  };
  jobs.set(record.id, record);
  running.set(type, record.id);
  prune();

  // Intentionally not awaited: the endpoint answers 202 immediately.
  void run()
    .then((result) => {
      record.status = 'SUCCESS';
      record.result = result ?? null;
      log.info('job succeeded', { jobId: record.id, type });
    })
    .catch((err: unknown) => {
      record.status = 'FAILED';
      record.error = err instanceof Error ? err.message : String(err);
      log.error('job failed', { jobId: record.id, type, error: record.error });
    })
    .finally(() => {
      record.finishedAt = new Date().toISOString();
      running.delete(type);
    });

  log.info('job started', { jobId: record.id, type, ...params });
  return record;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

/** Most recently started first. */
export function listJobs(limit = 50): JobRecord[] {
  return [...jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}
