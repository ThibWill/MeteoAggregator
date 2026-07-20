import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, type ApiServer } from '../../src/api/server.js';
import { resetJobs } from '../../src/api/services/jobs.js';

/**
 * These exercise routing, validation and the error envelope only — every case
 * here is rejected before the service layer issues a query, so no database is
 * required. DB-backed assertions live in `routes.db.test.ts`.
 */
let app: ApiServer;

beforeAll(async () => {
  resetJobs();
  app = await buildServer();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('reports liveness without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeS).toBe('number');
  });
});

describe('error envelope', () => {
  it('renders an unknown route as the standard shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'route GET /nope not found' },
    });
  });

  it('rejects /measurements with no town filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/measurements' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/town filter is required/);
  });

  it('rejects from > to before hitting the database', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/measurements?townId=1&from=2026-02-01&to=2026-01-01',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/must be on or after/);
  });

  it('rejects a period longer than 400 days', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/measurements?townId=1&from=2024-01-01&to=2026-01-01',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/exceeds the 400-day maximum/);
  });

  it('reports zod validation failures with details', async () => {
    const res = await app.inject({ method: 'GET', url: '/measurements?townId=1&limit=99999' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details).toBeTruthy();
  });

  it('rejects a malformed date', async () => {
    const res = await app.inject({ method: 'GET', url: '/measurements?townId=1&from=20260101' });
    expect(res.statusCode).toBe(400);
  });
});

describe('admin job triggers', () => {
  it('rejects a backfill body with no date range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/jobs/backfill-observations',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns an empty job list before anything has run', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
  });

  it('404s an unknown job id', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/jobs/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('OpenAPI contract', () => {
  it('serves the generated document', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe('3.1.0');
  });

  /**
   * Snapshot of the published contract: an unintended change to a request or
   * response shape shows up here as a diff rather than breaking a front end.
   */
  it('matches the committed contract snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json();
    const surface = Object.fromEntries(
      Object.entries(spec.paths as Record<string, Record<string, unknown>>).map(
        ([path, methods]) => [path, Object.keys(methods).sort()],
      ),
    );
    expect(surface).toMatchSnapshot();
  });
});
