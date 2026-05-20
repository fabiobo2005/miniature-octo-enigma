import { z } from 'zod';
import { uuid, isoDate, mealStatusEnum, positiveInt } from './common';

export const upsertMealSchema = z.object({
  user_id: uuid.optional(),
  date: isoDate,
  meal_id: z.string().trim().min(1).max(40),
  status: mealStatusEnum,
  notes: z.string().max(500).optional().nullable(),
});

export const upsertDietaProfileSchema = z.object({
  user_id: uuid.optional(),
  kcal_target: positiveInt.max(20000).optional().nullable(),
  meals_per_day: z.coerce.number().int().min(1).max(12).optional().nullable(),
  plan_source: z.string().max(200).optional().nullable(),
  started_on: isoDate.optional().nullable(),
});
