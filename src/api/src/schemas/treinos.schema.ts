import { z } from 'zod';
import { uuid, isoDate, intensityEnum, positiveInt } from './common';

export const createWorkoutSchema = z.object({
  user_id: uuid.optional(),
  trained_on: isoDate,
  name: z.string().trim().min(1).max(120),
  category: z.string().max(60).optional().nullable(),
  duration_min: positiveInt.max(720).optional().nullable(),
  intensity: intensityEnum.optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const updateWorkoutSchema = createWorkoutSchema.partial();
