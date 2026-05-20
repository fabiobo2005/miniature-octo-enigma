import { Router, Request, Response } from 'express';
import { withClient } from '../db';
import { validate } from '../middleware/validate';
import { createWorkoutSchema, updateWorkoutSchema } from '../schemas/treinos.schema';

export const treinosRouter = Router();

function requireUid(req: Request, res: Response): string | null {
  const v = (req.query.user_id || req.body?.user_id || req.headers['x-user-id']) as string | undefined;
  if (!v) { res.status(400).json({ error: 'user_id required' }); return null; }
  return String(v);
}

// ============ WORKOUT LOG ============
treinosRouter.get('/workouts', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const days = Math.min(Number(req.query.days || 60), 365);
    const rows = await withClient(async c => (await c.query(
      `SELECT * FROM treinos.workout_log
       WHERE user_id=$1 AND trained_on >= CURRENT_DATE - ($2::int - 1)
       ORDER BY trained_on DESC, id DESC`,
      [u, days]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

treinosRouter.post('/workouts', validate(createWorkoutSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { trained_on, name, category, duration_min, intensity, notes } = req.body;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO treinos.workout_log (user_id, trained_on, name, category, duration_min, intensity, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [u, trained_on, name, category || null, duration_min || null, intensity || null, notes || null]
    )).rows[0]);
    res.json(row);
  } catch (e) { next(e); }
});

treinosRouter.put('/workouts/:id', validate(updateWorkoutSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { trained_on, name, category, duration_min, intensity, notes } = req.body;
    const row = await withClient(async c => (await c.query(
      `UPDATE treinos.workout_log SET
         trained_on=COALESCE($3,trained_on),
         name=COALESCE($4,name),
         category=COALESCE($5,category),
         duration_min=COALESCE($6,duration_min),
         intensity=COALESCE($7,intensity),
         notes=COALESCE($8,notes),
         updated_at=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, u, trained_on ?? null, name ?? null, category ?? null, duration_min ?? null, intensity ?? null, notes ?? null]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

treinosRouter.delete('/workouts/:id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const ok = await withClient(async c => {
      const r = await c.query('DELETE FROM treinos.workout_log WHERE id=$1 AND user_id=$2', [req.params.id, u]);
      return (r.rowCount ?? 0) > 0;
    });
    if (ok) res.status(204).end();
    else res.status(404).json({ error: 'not found' });
  } catch (e) { next(e); }
});

treinosRouter.get('/workouts/summary', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const days = Math.min(Number(req.query.days || 7), 90);
    const row = await withClient(async c => (await c.query(
      `SELECT COUNT(*)::int AS sessions,
              COALESCE(SUM(duration_min),0)::int AS total_min,
              MAX(trained_on) AS last_date
       FROM treinos.workout_log
       WHERE user_id=$1 AND trained_on >= CURRENT_DATE - ($2::int - 1)`,
      [u, days]
    )).rows[0]);
    // mantém retrocompat com launcher (campo `minutes`)
    res.json({ ...row, minutes: row.total_min });
  } catch (e) { next(e); }
});
