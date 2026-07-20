import { z } from 'zod';

export const TimeRangeSchema = z.object({
  id: z.number().int(),
  code: z.string().nullable(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  sortOrder: z.number().int(),
  /** Derived `"07:00–13:00"`, so the front end does not re-implement it. */
  label: z.string(),
});
