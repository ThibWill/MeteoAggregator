import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginShutdown,
  getJob,
  listJobs,
  resetJobs,
  startJob,
} from '../../src/api/services/jobs.js';
import { ApiError } from '../../src/api/errors.js';

const never = () => new Promise<never>(() => {});
const settled = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetJobs());

describe('job registry', () => {
  it('starts a job as RUNNING and returns it by id', () => {
    const job = startJob('daily-run', { townName: 'Lyon' }, never);
    expect(job.status).toBe('RUNNING');
    expect(job.params).toEqual({ townName: 'Lyon' });
    expect(getJob(job.id)?.id).toBe(job.id);
  });

  it('refuses a second job of the same type with CONFLICT', () => {
    startJob('daily-run', {}, never);
    try {
      startJob('daily-run', {}, never);
      expect.unreachable('second trigger should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('CONFLICT');
      expect((err as ApiError).statusCode).toBe(409);
    }
  });

  it('allows a different job type to run concurrently', () => {
    startJob('daily-run', {}, never);
    expect(() => startJob('backfill-observations', {}, never)).not.toThrow();
  });

  it('records the task summary on success and frees the type', async () => {
    const job = startJob('daily-run', {}, async () => ({ towns: 2 }));
    await settled();
    expect(getJob(job.id)?.status).toBe('SUCCESS');
    expect(getJob(job.id)?.result).toEqual({ towns: 2 });
    expect(getJob(job.id)?.finishedAt).not.toBeNull();
    expect(() => startJob('daily-run', {}, never)).not.toThrow();
  });

  it('records the message on failure and frees the type', async () => {
    const job = startJob('daily-run', {}, async () => {
      throw new Error('connector exploded');
    });
    await settled();
    expect(getJob(job.id)?.status).toBe('FAILED');
    expect(getJob(job.id)?.error).toBe('connector exploded');
    expect(() => startJob('daily-run', {}, never)).not.toThrow();
  });

  it('refuses new jobs once shutdown has begun', () => {
    beginShutdown();
    expect(() => startJob('daily-run', {}, never)).toThrow(/shutting down/);
  });

  it('lists jobs most recently started first', async () => {
    const a = startJob('daily-run', {}, async () => 'a');
    await settled();
    const b = startJob('backfill-observations', {}, async () => 'b');
    await settled();
    expect(listJobs().map((j) => j.id)).toEqual([b.id, a.id]);
  });
});
