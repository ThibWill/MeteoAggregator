import { prisma, disconnect } from '../db/client.js';
import { saveTownCoordinates } from '../db/repo.js';
import { geocodeTown } from '../geocoding/geocoder.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'geocode' });

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const towns = await prisma.town.findMany({
    where: force ? {} : { OR: [{ latitude: null }, { longitude: null }] },
  });
  log.info('geocoding towns', { count: towns.length, force });

  for (const town of towns) {
    try {
      const geo = await geocodeTown({ name: town.name, country: town.country, adminArea: town.adminArea });
      if (!geo) {
        log.warn('no result', { name: town.name });
        continue;
      }
      await saveTownCoordinates(town.id, geo.latitude, geo.longitude, geo.bbox);
      log.info('geocoded', {
        name: town.name,
        lat: geo.latitude,
        lon: geo.longitude,
        provider: geo.provider,
      });
    } catch (err) {
      log.error('failed', { name: town.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

main()
  .catch((err) => {
    log.error('geocode cli failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
