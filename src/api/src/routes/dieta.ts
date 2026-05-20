import { Router, Request, Response } from 'express';
import { withClient } from '../db';
import { validate } from '../middleware/validate';
import { upsertMealSchema, upsertDietaProfileSchema } from '../schemas/dieta.schema';

export const dietaRouter = Router();

function requireUid(req: Request, res: Response): string | null {
  const v = (req.query.user_id || req.body?.user_id || req.headers['x-user-id']) as string | undefined;
  if (!v) { res.status(400).json({ error: 'user_id required' }); return null; }
  return String(v);
}

// ============ MEAL LOG ============
dietaRouter.get('/meals', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const days = Math.min(Number(req.query.days || 30), 365);
    const rows = await withClient(async c => (await c.query(
      `SELECT logged_on, meal_id, status, notes FROM dieta.meal_log
       WHERE user_id=$1 AND logged_on >= CURRENT_DATE - ($2::int - 1)
       ORDER BY logged_on DESC, meal_id`,
      [u, days]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

dietaRouter.put('/meals', validate(upsertMealSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { date, meal_id, status, notes } = req.body;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO dieta.meal_log (user_id, logged_on, meal_id, status, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, logged_on, meal_id) DO UPDATE SET status=EXCLUDED.status, notes=EXCLUDED.notes, updated_at=now()
       RETURNING *`,
      [u, date, meal_id, status, notes || null]
    )).rows[0]);
    res.json(row);
  } catch (e) { next(e); }
});

dietaRouter.delete('/meals/:date/:meal_id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    await withClient(async c => { await c.query('DELETE FROM dieta.meal_log WHERE user_id=$1 AND logged_on=$2 AND meal_id=$3', [u, req.params.date, req.params.meal_id]); });
    res.status(204).end();
  } catch (e) { next(e); }
});

dietaRouter.get('/meals/summary', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const days = Math.min(Number(req.query.days || 30), 365);
    const totalMeals = Number(req.query.total_meals || 6);
    const rows = await withClient(async c => (await c.query(
      `WITH d AS (
         SELECT generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, '1 day')::date AS day
       )
       SELECT d.day,
         COUNT(ml.*) FILTER (WHERE ml.status='done')    AS done,
         COUNT(ml.*) FILTER (WHERE ml.status='partial') AS partial,
         COUNT(ml.*) FILTER (WHERE ml.status='skipped') AS skipped
       FROM d LEFT JOIN dieta.meal_log ml ON ml.logged_on = d.day AND ml.user_id = $1
       GROUP BY d.day ORDER BY d.day`,
      [u, days]
    )).rows.map(r => ({
      day: r.day,
      done: Number(r.done),
      partial: Number(r.partial),
      skipped: Number(r.skipped),
      score: Math.round((Number(r.done) + Number(r.partial) * 0.5) / totalMeals * 100)
    })));
    res.json(rows);
  } catch (e) { next(e); }
});

// Perfil de dieta (kcal alvo) — opcional
dietaRouter.get('/profile', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const row = await withClient(async c => (await c.query(
      'SELECT * FROM dieta.profile WHERE user_id=$1', [u]
    )).rows[0]);
    res.json(row || null);
  } catch (e) { next(e); }
});

dietaRouter.put('/profile', validate(upsertDietaProfileSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { kcal_target, meals_per_day, plan_source, started_on } = req.body;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO dieta.profile (user_id, kcal_target, meals_per_day, plan_source, started_on)
       VALUES ($1,$2,COALESCE($3,6),$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         kcal_target=COALESCE(EXCLUDED.kcal_target, dieta.profile.kcal_target),
         meals_per_day=COALESCE(EXCLUDED.meals_per_day, dieta.profile.meals_per_day),
         plan_source=COALESCE(EXCLUDED.plan_source, dieta.profile.plan_source),
         started_on=COALESCE(EXCLUDED.started_on, dieta.profile.started_on),
         updated_at=now()
       RETURNING *`,
      [u, kcal_target || null, meals_per_day || null, plan_source || null, started_on || null]
    )).rows[0]);
    res.json(row);
  } catch (e) { next(e); }
});
