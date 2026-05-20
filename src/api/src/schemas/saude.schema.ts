import { z } from 'zod';
import { uuid, isoDate, supplementStatusEnum } from './common';

export const upsertEvolSchema = z.object({
  user_id: uuid.optional(),
  d: isoDate,
  p: z.number().positive().max(500).optional().nullable(),
  bf: z.number().min(0).max(80).optional().nullable(),
  mm: z.number().min(0).max(120).optional().nullable(),
  visc: z.number().min(0).max(60).optional().nullable(),
  agua: z.number().min(0).max(100).optional().nullable(),
  mskel: z.number().min(0).max(100).optional().nullable(),
  gsub: z.number().min(0).max(80).optional().nullable(),
  osso: z.number().min(0).max(10).optional().nullable(),
  prot: z.number().min(0).max(50).optional().nullable(),
  tmb: z.number().int().positive().max(10000).optional().nullable(),
  idade: z.number().int().min(0).max(120).optional().nullable(),
});

export const createSupplementSchema = z.object({
  user_id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  dose: z.string().max(60).optional().nullable(),
  schedule: z.string().max(120).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  icon: z.string().max(8).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const updateSupplementSchema = createSupplementSchema.partial().extend({
  active: z.boolean().optional(),
});

export const logSupplementSchema = z.object({
  user_id: uuid.optional(),
  date: isoDate.optional(),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
  status: supplementStatusEnum.optional(),
});
