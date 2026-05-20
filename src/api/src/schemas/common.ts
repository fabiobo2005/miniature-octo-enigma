import { z } from 'zod';

export const uuid = z.string().uuid({ message: 'must be a valid UUID' });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'must be YYYY-MM-DD',
});

export const positiveInt = z.coerce.number().int().positive();
export const nonNegativeInt = z.coerce.number().int().nonnegative();

export const intensityEnum = z.enum(['leve', 'moderado', 'forte', 'maximo']);
export const mealStatusEnum = z.enum(['done', 'partial', 'skipped']);
export const supplementStatusEnum = z.enum(['taken', 'missed', 'skipped']);
export const goalEnum = z.enum(['cut', 'recomp', 'bulk', 'maintain']);
