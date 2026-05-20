import { Router } from 'express';
import { withClient } from '../db';

export const usersRouter = Router();

usersRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await withClient(async c => (await c.query(
      `SELECT id, name, email, avatar_url, birth_date, height_cm, goal, created_at
       FROM app.user WHERE active = TRUE ORDER BY name`
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const { name, email, avatar_url, birth_date, height_cm, goal } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const row = await withClient(async c => (await c.query(
      `INSERT INTO app.user (name, email, avatar_url, birth_date, height_cm, goal)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [String(name).trim(), email || null, avatar_url || null, birth_date || null, height_cm || null, goal || null]
    )).rows[0]);
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'email already exists' });
    next(e);
  }
});

usersRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await withClient(async c => (await c.query(
      'SELECT * FROM app.user WHERE id=$1 AND active=TRUE', [req.params.id]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

usersRouter.put('/:id', async (req, res, next) => {
  try {
    const { name, email, avatar_url, birth_date, height_cm, goal } = req.body || {};
    const row = await withClient(async c => (await c.query(
      `UPDATE app.user SET
         name=COALESCE($2,name), email=COALESCE($3,email), avatar_url=COALESCE($4,avatar_url),
         birth_date=COALESCE($5,birth_date), height_cm=COALESCE($6,height_cm), goal=COALESCE($7,goal),
         updated_at=now()
       WHERE id=$1 AND active=TRUE RETURNING *`,
      [req.params.id, name ?? null, email ?? null, avatar_url ?? null, birth_date ?? null, height_cm ?? null, goal ?? null]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    await withClient(async c => { await c.query('UPDATE app.user SET active=FALSE, updated_at=now() WHERE id=$1', [req.params.id]); });
    res.status(204).end();
  } catch (e) { next(e); }
});

// Status: existe dado em cada área? (usado pelo frontend para decidir overlay obrigatório)
usersRouter.get('/:id/status', async (req, res, next) => {
  try {
    const uid = req.params.id;
    const data = await withClient(async c => {
      const user = (await c.query('SELECT id, name FROM app.user WHERE id=$1 AND active=TRUE', [uid])).rows[0];
      if (!user) return null;
      const [evol, supp, meals, wks] = await Promise.all([
        c.query('SELECT count(*)::int AS n FROM saude.evolution WHERE user_id=$1', [uid]),
        c.query('SELECT count(*)::int AS n FROM saude.supplement WHERE user_id=$1 AND active=TRUE', [uid]),
        c.query('SELECT count(*)::int AS n FROM dieta.meal_log WHERE user_id=$1', [uid]),
        c.query('SELECT count(*)::int AS n FROM treinos.workout_log WHERE user_id=$1', [uid]),
      ]);
      return {
        user,
        saude:   { has_data: (evol.rows[0].n + supp.rows[0].n) > 0, evolution: evol.rows[0].n, supplements: supp.rows[0].n },
        dieta:   { has_data: meals.rows[0].n > 0, meals: meals.rows[0].n },
        treinos: { has_data: wks.rows[0].n > 0, workouts: wks.rows[0].n }
      };
    });
    if (!data) return res.status(404).json({ error: 'user not found' });
    res.json(data);
  } catch (e) { next(e); }
});
