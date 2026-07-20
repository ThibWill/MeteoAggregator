import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';
import { buildServer, type ApiServer } from '../../src/api/server.js';

/**
 * Route tests against a real database. They assert envelope shape, ordering and
 * status codes — never specific values — so they pass against any seeded DB.
 * Skipped (not failed) when no database is reachable, so `npm test` still runs
 * on a machine without docker.
 */
const reachable = await prisma
  .$queryRaw`SELECT 1`.then(() => true)
  .catch(() => false);

const suite = reachable ? describe : describe.skip;

let app: ApiServer;

beforeAll(async () => {
  if (reachable) app = await buildServer();
});

afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

suite('reference data', () => {
  it('returns towns in the { data, meta } envelope sorted by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/towns' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ limit: 100, offset: 0 });
    expect(typeof body.meta.total).toBe('number');

    const names = body.data.map((t: { name: string }) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it('never exposes the PostGIS geom column', async () => {
    const res = await app.inject({ method: 'GET', url: '/towns' });
    expect(JSON.stringify(res.json())).not.toContain('geom');
  });

  it('omits source config, which may hold credentials-adjacent settings', async () => {
    const res = await app.inject({ method: 'GET', url: '/sources' });
    expect(res.statusCode).toBe(200);
    for (const s of res.json().data) expect(s).not.toHaveProperty('config');
  });

  it('derives a human label for each time range', async () => {
    const res = await app.inject({ method: 'GET', url: '/time-ranges' });
    expect(res.statusCode).toBe(200);
    for (const r of res.json().data) expect(r.label).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  });

  it('404s an unknown town id', async () => {
    const res = await app.inject({ method: 'GET', url: '/towns/999999' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('returns coverage on the town detail', async () => {
    const list = await app.inject({ method: 'GET', url: '/towns?limit=1' });
    const first = list.json().data[0];
    if (!first) return;
    const res = await app.inject({ method: 'GET', url: `/towns/${first.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coverage).toHaveProperty('measurementCount');
    expect(Array.isArray(body.sources)).toBe(true);
  });
});

suite('measurements', () => {
  async function firstTownId(): Promise<number | undefined> {
    const res = await app.inject({ method: 'GET', url: '/towns?limit=1' });
    return res.json().data[0]?.id;
  }

  it('returns dates as YYYY-MM-DD and excludes raw by default', async () => {
    const townId = await firstTownId();
    if (townId === undefined) return;
    const res = await app.inject({
      method: 'GET',
      url: `/measurements?townId=${townId}&from=2020-01-01&to=2020-01-02`,
    });
    expect(res.statusCode).toBe(200);

    const wide = await app.inject({
      method: 'GET',
      url: `/measurements?townId=${townId}&limit=5`,
    });
    for (const m of wide.json().data) {
      expect(m.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m).not.toHaveProperty('raw');
      if (m.referenceTime !== null) expect(m.referenceTime).toMatch(/Z$/);
    }
  });

  it('includes raw only when asked', async () => {
    const townId = await firstTownId();
    if (townId === undefined) return;
    const res = await app.inject({
      method: 'GET',
      url: `/measurements?townId=${townId}&limit=1&include=raw`,
    });
    expect(res.statusCode).toBe(200);
    for (const m of res.json().data) expect(m).toHaveProperty('raw');
  });

  it('sorts by target date then time-range order', async () => {
    const townId = await firstTownId();
    if (townId === undefined) return;
    const res = await app.inject({
      method: 'GET',
      url: `/measurements?townId=${townId}&limit=1000`,
    });
    const dates = res.json().data.map((m: { targetDate: string }) => m.targetDate);
    expect(dates).toEqual([...dates].sort());
  });

  it('returns at most one row per slot per source with latestOnly', async () => {
    const townId = await firstTownId();
    if (townId === undefined) return;
    const res = await app.inject({
      method: 'GET',
      url: `/measurements?townId=${townId}&latestOnly=true&limit=1000`,
    });
    const keys = res
      .json()
      .data.map(
        (m: Record<string, unknown>) =>
          `${m.sourceId}|${m.kind}|${m.targetDate}|${m.timeRangeId}`,
      );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('aligns every timeseries point array with the index', async () => {
    const townId = await firstTownId();
    if (townId === undefined) return;
    const res = await app.inject({
      method: 'GET',
      url: `/measurements/timeseries?townId=${townId}&limit=1000`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const s of body.series) expect(s.points).toHaveLength(body.index.length);
  });
});

suite('analysis and reports', () => {
  it('serves comparison rows in the envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/comparison' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('meta');
  });

  it('returns all three windows by default and one when filtered', async () => {
    const all = await app.inject({ method: 'GET', url: '/reliability' });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((w: { window: string }) => w.window)).toEqual([
      '7d',
      '30d',
      '365d',
    ]);

    const one = await app.inject({ method: 'GET', url: '/reliability?window=30d' });
    expect(one.json().data).toHaveLength(1);
  });

  it('404s an unknown town on /reliability', async () => {
    const res = await app.inject({ method: 'GET', url: '/reliability?town=Atlantis' });
    expect(res.statusCode).toBe(404);
  });

  it('sorts reports by run date descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports?limit=1000' });
    expect(res.statusCode).toBe(200);
    const dates = res.json().data.map((r: { runDate: string }) => r.runDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('serves the per-run-date status summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/summary' });
    expect(res.statusCode).toBe(200);
    for (const r of res.json().data) {
      expect(r.total).toBe(r.pending + r.success + r.partial + r.failed);
    }
  });

  it('404s an unknown report id', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/999999' });
    expect(res.statusCode).toBe(404);
  });
});
