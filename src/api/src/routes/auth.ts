import { Router } from 'express';
import { withClient } from '../db';

export const authRouter = Router();

function cleanString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

authRouter.post('/register-personal', async (req, res, next) => {
  try {
    const name = cleanString(req.body?.name, 100);
    const email = cleanString(req.body?.email, 200);
    const specialization = cleanString(req.body?.specialization, 200);
    const bio = cleanString(req.body?.bio, 2000);
    const entraObjectId = cleanString(req.body?.entra_object_id, 100);

    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    const row = await withClient(async c => (await c.query(
      `INSERT INTO app."user" (name, email, role, status, specialization, bio, entra_object_id, upn)
       VALUES ($1, $2, 'personal', 'pending', $3, $4, $5, $2)
       RETURNING id, status`,
      [name, email, specialization, bio, entraObjectId]
    )).rows[0]);

    res.status(201).json({ id: row.id, status: row.status });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'user already exists' });
    next(e);
  }
});
