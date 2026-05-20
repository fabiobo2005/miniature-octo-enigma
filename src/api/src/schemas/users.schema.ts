import { z } from 'zod';
import { isoDate, goalEnum, positiveInt } from './common';

const baseUser = {
  name: z.string().trim().min(1).max(100),
  email: z.string().email().max(200).nullable().optional(),
  avatar_url: z.string().url().max(500).nullable().optional(),
  birth_date: isoDate.nullable().optional(),
  height_cm: positiveInt.max(300).nullable().optional(),
  goal: goalEnum.nullable().optional(),
};

export const createUserSchema = z.object(baseUser).strict();

export const updateUserSchema = z.object({
  name: baseUser.name.optional(),
  email: baseUser.email,
  avatar_url: baseUser.avatar_url,
  birth_date: baseUser.birth_date,
  height_cm: baseUser.height_cm,
  goal: baseUser.goal,
}).strict();
