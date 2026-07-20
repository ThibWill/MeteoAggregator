import { z } from 'zod';
import { BoolParam, PaginationQuery, SourceKindEnum } from './common.js';

/** `config` is deliberately absent: it can hold credentials-adjacent settings. */
export const SourceSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  kind: SourceKindEnum,
  maxHorizonDays: z.number().int(),
  resolution: z.string().nullable(),
  active: z.boolean(),
});

export const SourceListQuery = PaginationQuery.extend({
  kind: SourceKindEnum.optional(),
  active: BoolParam.optional(),
});
