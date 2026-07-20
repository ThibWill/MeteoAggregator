import { prisma, disconnect } from '../db/client.js';
import {
  computeReliability,
  WINDOWS,
  type ConfusionCell,
  type WindowReport,
} from '../domain/reliability.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'reliability' });

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

const OBS_SOURCE_CODE = 'mf-climatologie';

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const windowArg = argValue('window');
  const townName = argValue('town');
  const sourceCode = argValue('source');

  const townMap = new Map<number, string>();
  for (const t of await prisma.town.findMany()) townMap.set(t.id, t.name);
  const rangeMap = new Map<number, string>();
  for (const r of await prisma.timeRange.findMany()) {
    rangeMap.set(r.id, r.code ?? `${r.startMinute}-${r.endMinute}`);
  }

  const town = townName
    ? await prisma.town.findFirst({ where: { name: { equals: townName, mode: 'insensitive' } } })
    : null;
  if (townName && !town) throw new Error(`town not found: ${townName}`);
  const forecastSource = sourceCode
    ? await prisma.source.findUnique({ where: { code: sourceCode } })
    : null;
  if (sourceCode && !forecastSource) throw new Error(`source not found: ${sourceCode}`);
  const obsSource = await prisma.source.findUnique({ where: { code: OBS_SOURCE_CODE } });

  const reports = await computeReliability({
    townId: town?.id,
    forecastSourceId: forecastSource?.id,
    observedSourceId: obsSource?.id,
  });

  const selected = windowArg
    ? reports.filter((r) => r.window === windowArg || String(r.days) === windowArg)
    : reports;
  if (windowArg && selected.length === 0) {
    throw new Error(`unknown window: ${windowArg} (use ${WINDOWS.map((w) => w.label).join(', ')})`);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(selected, null, 2) + '\n');
    return;
  }
  for (const report of selected) {
    printWindow(report, townMap, rangeMap);
  }
}

function printWindow(
  report: WindowReport,
  townMap: Map<number, string>,
  rangeMap: Map<number, string>,
): void {
  const out = process.stdout;
  out.write(`\n=== window ${report.window} (since ${report.since}) ===\n`);
  if (report.groups.length === 0) {
    out.write('  no matched forecast/observation pairs\n');
    return;
  }
  const header = [
    pad('town', 12),
    pad('range', 10),
    pad('lead', 8),
    pad('~h', 5),
    pad('n', 5),
    pad('cat%', 6),
    pad('prcp%', 6),
    pad('tMAE', 6),
    pad('tBias', 6),
    pad('pMAE', 6),
    pad('pBias', 6),
    pad('wMAE', 6),
    pad('gMAE', 6),
    pad('cMAE', 6),
  ].join(' ');
  out.write(header + '\n');
  for (const g of report.groups) {
    out.write(
      [
        pad(townMap.get(g.townId) ?? String(g.townId), 12),
        pad(rangeMap.get(g.timeRangeId) ?? String(g.timeRangeId), 10),
        pad(g.leadBucket, 8),
        pad(g.leadHours === null ? '-' : g.leadHours.toFixed(0), 5),
        pad(String(g.n), 5),
        pad(pct(g.catAgreePct), 6),
        pad(pct(g.precipAgreePct), 6),
        pad(fix(g.tempMae), 6),
        pad(fix(g.tempBias), 6),
        pad(fix(g.precipMae), 6),
        pad(fix(g.precipBias), 6),
        pad(fix(g.windMae), 6),
        pad(fix(g.gustMae), 6),
        pad(fix(g.cloudMae), 6),
      ].join(' ') + '\n',
    );
  }
  printConfusion(report.confusion);
}

function printConfusion(cells: ConfusionCell[]): void {
  if (cells.length === 0) return;
  const out = process.stdout;
  const cats = [...new Set(cells.flatMap((c) => [c.forecast, c.observed]))].sort();
  const lookup = new Map(cells.map((c) => [`${c.forecast}|${c.observed}`, c.count]));
  out.write('  category confusion (rows=forecast, cols=observed):\n');
  out.write('    ' + pad('', 14) + cats.map((c) => pad(short(c), 6)).join(' ') + '\n');
  for (const f of cats) {
    const row = cats.map((o) => pad(String(lookup.get(`${f}|${o}`) ?? 0), 6)).join(' ');
    out.write('    ' + pad(short(f), 14) + row + '\n');
  }
}

const short = (c: string): string => c.slice(0, 6);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s.padStart(n));
const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);
const fix = (v: number | null): string => (v === null ? '-' : v.toFixed(1));

main()
  .catch((err) => {
    log.error('reliability cli failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
