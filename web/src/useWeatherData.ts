import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import { DEMO_RANGES, DEMO_TOWNS, demoMeasurements } from './demo';
import { indexRows, type RowsByTown } from './weather';
import type { Measurement, TimeRange, Town } from './types';

export type DataMode = 'loading' | 'live' | 'demo';

export interface WeatherData {
  towns: Town[];
  timeRanges: TimeRange[];
  rows: RowsByTown;
  mode: DataMode;
  loading: boolean;
  error: string | null;
}

/**
 * Loads reference data once, then (re)loads measurements whenever the queried
 * day or window changes. Falls back to demo data if the API is unreachable.
 */
export function useWeatherData(date: string, timeRangeId: number | null) {
  const [towns, setTowns] = useState<Town[]>([]);
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([]);
  const [rows, setRows] = useState<RowsByTown>({});
  const [mode, setMode] = useState<DataMode>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- reference (towns + time ranges), once ----
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const [tw, tr] = await Promise.all([api.towns(ctrl.signal), api.timeRanges(ctrl.signal)]);
        const geocoded = tw.filter((t) => t.latitude != null && t.longitude != null);
        if (!geocoded.length || !tr.length) throw new Error('empty reference');
        setTowns(geocoded);
        setTimeRanges(tr);
        setMode('live');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setTowns(DEMO_TOWNS);
        setTimeRanges(DEMO_RANGES);
        setMode('demo');
        setError(e instanceof ApiError ? e.message : String(e));
      }
    })();
    return () => ctrl.abort();
  }, []);

  // ---- measurements, on date/window change ----
  const reload = useCallback(
    (signal?: AbortSignal) => {
      if (mode === 'loading' || timeRangeId == null || !towns.length) return;
      if (mode === 'demo') {
        setRows(indexRows(towns.map((t) => t.id), demoMeasurements(towns, date, timeRangeId)));
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      Promise.all(
        towns.map((t) =>
          api
            .measurements({ townId: t.id, date, timeRangeId }, signal)
            .catch((): Measurement[] => []),
        ),
      )
        .then((lists) => {
          if (signal?.aborted) return;
          setRows(indexRows(towns.map((t) => t.id), lists.flat()));
          setLoading(false);
        })
        .catch((e) => {
          if (signal?.aborted) return;
          setLoading(false);
          setError(e instanceof ApiError ? e.message : String(e));
        });
    },
    [mode, towns, date, timeRangeId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    reload(ctrl.signal);
    return () => ctrl.abort();
  }, [reload]);

  const data: WeatherData = useMemo(
    () => ({ towns, timeRanges, rows, mode, loading, error }),
    [towns, timeRanges, rows, mode, loading, error],
  );
  return data;
}
