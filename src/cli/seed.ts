import { prisma, disconnect } from '../db/client.js';
import { geocodeTown } from '../geocoding/geocoder.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'seed' });

// Offsets in minutes from each town's *local* midnight.
const TIME_RANGES = [
  { code: 'night', startMinute: 0, endMinute: 420, sortOrder: 0 },
  { code: 'morning', startMinute: 420, endMinute: 780, sortOrder: 1 },
  { code: 'afternoon', startMinute: 780, endMinute: 1140, sortOrder: 2 },
  { code: 'evening', startMinute: 1140, endMinute: 1440, sortOrder: 3 },
];

const TOWNS = [
  { name: 'Lyon', country: 'FR', adminArea: null, timezone: 'Europe/Paris' },
  { name: 'Mulhouse', country: 'FR', adminArea: null, timezone: 'Europe/Paris' },
  { name: 'Paris', country: 'FR', adminArea: null, timezone: 'Europe/Paris' },
  { name: 'Plouha', country: 'FR', adminArea: null, timezone: 'Europe/Paris' },
];

async function seedTimeRanges(): Promise<void> {
  for (const tr of TIME_RANGES) {
    const existing = await prisma.timeRange.findFirst({
      where: { startMinute: tr.startMinute, endMinute: tr.endMinute },
    });
    if (existing) {
      await prisma.timeRange.update({ where: { id: existing.id }, data: tr });
    } else {
      await prisma.timeRange.create({ data: tr });
    }
  }
  log.info('seeded time ranges', { count: TIME_RANGES.length });
}

async function seedSources(): Promise<{ aromeId: number; climId: number }> {
  const arome = await prisma.source.upsert({
    where: { code: 'arome-0025-france' },
    create: {
      code: 'arome-0025-france',
      name: 'Meteo-France AROME 0025 (France)',
      kind: 'FORECAST',
      maxHorizonDays: 2,
      resolution: '2.5km',
      active: true,
    },
    update: {},
  });

  // Stub kept for any rows already attached to it, but disabled.
  await prisma.source.upsert({
    where: { code: 'observation-stub' },
    create: {
      code: 'observation-stub',
      name: 'Observation (stub)',
      kind: 'OBSERVATION',
      maxHorizonDays: 0,
      active: false,
    },
    update: { active: false },
  });

  const clim = await prisma.source.upsert({
    where: { code: 'mf-climatologie' },
    create: {
      code: 'mf-climatologie',
      name: 'Meteo-France Climatologie (stations)',
      kind: 'OBSERVATION',
      maxHorizonDays: 0,
      active: true,
    },
    update: { active: true },
  });

  log.info('seeded sources');
  return { aromeId: arome.id, climId: clim.id };
}

async function seedTowns(sourceIds: number[]): Promise<void> {
  for (const t of TOWNS) {
    // adminArea is nullable so Prisma's compound-unique input can't express it;
    // find-or-create by the natural key manually.
    const existing = await prisma.town.findFirst({
      where: { name: t.name, country: t.country, adminArea: t.adminArea },
    });
    const town = existing
      ? await prisma.town.update({ where: { id: existing.id }, data: { timezone: t.timezone } })
      : await prisma.town.create({ data: t });

    if (town.latitude === null || town.longitude === null) {
      try {
        const geo = await geocodeTown({ name: t.name, country: t.country });
        if (geo) {
          await prisma.town.update({
            where: { id: town.id },
            data: { latitude: geo.latitude, longitude: geo.longitude, geocodedAt: new Date() },
          });
          await prisma.$executeRaw`
            UPDATE "town" SET "geom" = ST_SetSRID(ST_MakePoint(${geo.longitude}, ${geo.latitude}), 4326)
            WHERE "id" = ${town.id}`;
          log.info('geocoded town', { name: t.name, lat: geo.latitude, lon: geo.longitude });
        } else {
          log.warn('could not geocode town', { name: t.name });
        }
      } catch (err) {
        log.warn('geocoding error (leaving town without coordinates)', {
          name: t.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const sourceId of sourceIds) {
      await prisma.townSource.upsert({
        where: { townId_sourceId: { townId: town.id, sourceId } },
        create: { townId: town.id, sourceId, active: true },
        update: { active: true },
      });
    }
  }
  log.info('seeded towns + town_source links', { count: TOWNS.length });
}

async function main(): Promise<void> {
  await seedTimeRanges();
  const { aromeId, climId } = await seedSources();
  await seedTowns([aromeId, climId]);
  log.info('seed complete');
}

main()
  .catch((err) => {
    log.error('seed failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
