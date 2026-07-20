import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '../../src/api/period.js';
import { ApiError } from '../../src/api/errors.js';
import { BoolParam, PaginationQuery, repeatable } from '../../src/api/schemas/common.js';
import { MeasurementListQuery } from '../../src/api/schemas/measurement.js';
import { z } from 'zod';

const NOW = new Date('2026-07-20T09:30:00.000Z');

describe('resolvePeriod', () => {
  it('defaults to the last 7 days ending today when nothing is given', () => {
    const p = resolvePeriod({}, { now: NOW });
    expect(p).toMatchObject({ from: '2026-07-14', to: '2026-07-20' });
  });

  it('keeps explicit inclusive bounds', () => {
    const p = resolvePeriod({ from: '2026-01-01', to: '2026-01-31' }, { now: NOW });
    expect(p.from).toBe('2026-01-01');
    expect(p.to).toBe('2026-01-31');
    expect(p.fromDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects to < from', () => {
    expect(() => resolvePeriod({ from: '2026-02-01', to: '2026-01-01' }, { now: NOW })).toThrow(
      ApiError,
    );
  });

  it('rejects a period longer than 400 days', () => {
    expect(() => resolvePeriod({ from: '2024-01-01', to: '2026-01-01' }, { now: NOW })).toThrow(
      /exceeds the 400-day maximum/,
    );
  });

  it('allows an uncapped period when maxDays is null', () => {
    const p = resolvePeriod({ from: '2020-01-01', to: '2026-01-01' }, { now: NOW, maxDays: null });
    expect(p.from).toBe('2020-01-01');
  });

  it('accepts a period of exactly 400 days', () => {
    // 2026-07-20 minus 399 days, inclusive on both ends = 400.
    const p = resolvePeriod({ from: '2025-06-16', to: '2026-07-20' }, { now: NOW });
    expect(p.from).toBe('2025-06-16');
  });
});

describe('BoolParam', () => {
  it('parses "false" as false rather than truthy-string', () => {
    expect(BoolParam.parse('false')).toBe(false);
    expect(BoolParam.parse('0')).toBe(false);
    expect(BoolParam.parse('true')).toBe(true);
    expect(BoolParam.parse('1')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(() => BoolParam.parse('yes')).toThrow();
  });
});

describe('repeatable', () => {
  const schema = z.object({ id: repeatable(z.coerce.number().int()) });

  it('normalizes a single value to an array', () => {
    expect(schema.parse({ id: '3' })).toEqual({ id: [3] });
  });

  it('keeps a repeated value as an array', () => {
    expect(schema.parse({ id: ['1', '2'] })).toEqual({ id: [1, 2] });
  });

  it('stays undefined when absent', () => {
    expect(schema.parse({})).toEqual({ id: undefined });
  });
});

describe('PaginationQuery', () => {
  it('applies the documented defaults', () => {
    expect(PaginationQuery.parse({})).toEqual({ limit: 100, offset: 0 });
  });

  it('caps limit at 1000', () => {
    expect(() => PaginationQuery.parse({ limit: '1001' })).toThrow();
    expect(PaginationQuery.parse({ limit: '1000' }).limit).toBe(1000);
  });

  it('rejects a negative offset', () => {
    expect(() => PaginationQuery.parse({ offset: '-1' })).toThrow();
  });
});

describe('MeasurementListQuery', () => {
  it('defaults latestOnly to true', () => {
    expect(MeasurementListQuery.parse({ town: 'Lyon' }).latestOnly).toBe(true);
  });

  it('honours latestOnly=false', () => {
    expect(MeasurementListQuery.parse({ town: 'Lyon', latestOnly: 'false' }).latestOnly).toBe(
      false,
    );
  });

  it('rejects an unknown kind', () => {
    expect(() => MeasurementListQuery.parse({ town: 'Lyon', kind: 'GUESS' })).toThrow();
  });

  it('only accepts "raw" for include', () => {
    expect(MeasurementListQuery.parse({ town: 'Lyon', include: 'raw' }).include).toBe('raw');
    expect(() => MeasurementListQuery.parse({ town: 'Lyon', include: 'everything' })).toThrow();
  });
});
