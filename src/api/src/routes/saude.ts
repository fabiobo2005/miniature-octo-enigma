import { Router, Request, Response, NextFunction } from 'express';
import { withClient } from '../db';
import { validate } from '../middleware/validate';
import {
  upsertEvolSchema,
  createSupplementSchema,
  updateSupplementSchema,
  logSupplementSchema,
} from '../schemas/saude.schema';

export const saudeRouter = Router();

// helper: extrai user_id de query (GET/DELETE) ou body (POST/PUT). Retorna null se ausente.
function uid(req: Request): string | null {
  const v = (req.query.user_id || req.body?.user_id || req.headers['x-user-id']) as string | undefined;
  return v ? String(v) : null;
}
function requireUid(req: Request, res: Response): string | null {
  const u = uid(req);
  if (!u) { res.status(400).json({ error: 'user_id required' }); return null; }
  return u;
}

// ============ EVOLUTION ============
saudeRouter.get('/evol', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const rows = await withClient(async c => (await c.query(
      'SELECT * FROM saude.evolution WHERE user_id=$1 ORDER BY measured_on DESC', [u]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

const upsertEvol = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const body = req.body;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO saude.evolution
        (user_id, measured_on, peso, bf, mm, visc, agua, mskel, gsub, osso, prot, tmb, idade_corpo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (user_id, measured_on) DO UPDATE SET
        peso=EXCLUDED.peso, bf=EXCLUDED.bf, mm=EXCLUDED.mm,
        visc=EXCLUDED.visc, agua=EXCLUDED.agua, mskel=EXCLUDED.mskel,
        gsub=EXCLUDED.gsub, osso=EXCLUDED.osso, prot=EXCLUDED.prot,
        tmb=EXCLUDED.tmb, idade_corpo=EXCLUDED.idade_corpo,
        updated_at=now()
       RETURNING *`,
      [u, body.d, body.p ?? null, body.bf ?? null, body.mm ?? null,
       body.visc ?? null, body.agua ?? null, body.mskel ?? null,
       body.gsub ?? null, body.osso ?? null, body.prot ?? null,
       body.tmb ?? null, body.idade ?? null]
    )).rows[0]);
    res.json(row);
  } catch (e) { next(e); }
};
saudeRouter.put('/evol', validate(upsertEvolSchema), upsertEvol);
saudeRouter.post('/evol', validate(upsertEvolSchema), upsertEvol);

saudeRouter.delete('/evol/:date', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const ok = await withClient(async c => {
      const r = await c.query('DELETE FROM saude.evolution WHERE user_id=$1 AND measured_on=$2', [u, req.params.date]);
      return (r.rowCount ?? 0) > 0;
    });
    if (ok) res.status(204).end();
    else res.status(404).json({ error: 'not found' });
  } catch (e) { next(e); }
});

// ============ SUPPLEMENTS ============
saudeRouter.get('/supplements', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const rows = await withClient(async c => (await c.query(
      'SELECT * FROM saude.supplement WHERE user_id=$1 AND active=TRUE ORDER BY id', [u]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

saudeRouter.post('/supplements', validate(createSupplementSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { name, dose, schedule, color, icon, notes } = req.body;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO saude.supplement (user_id, name, dose, schedule, color, icon, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5,'#7BC4A4'),COALESCE($6,'💊'),$7) RETURNING *`,
      [u, name, dose || null, schedule || null, color || null, icon || null, notes || null]
    )).rows[0]);
    res.json(row);
  } catch (e) { next(e); }
});

saudeRouter.put('/supplements/:id', validate(updateSupplementSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { name, dose, schedule, color, icon, notes, active } = req.body;
    const row = await withClient(async c => (await c.query(
      `UPDATE saude.supplement SET
         name=COALESCE($3,name), dose=COALESCE($4,dose), schedule=COALESCE($5,schedule),
         color=COALESCE($6,color), icon=COALESCE($7,icon), notes=COALESCE($8,notes),
         active=COALESCE($9,active), updated_at=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, u, name ?? null, dose ?? null, schedule ?? null, color ?? null, icon ?? null, notes ?? null, active ?? null]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

saudeRouter.delete('/supplements/:id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    await withClient(async c => { await c.query('UPDATE saude.supplement SET active=FALSE WHERE id=$1 AND user_id=$2', [req.params.id, u]); });
    res.status(204).end();
  } catch (e) { next(e); }
});

saudeRouter.post('/supplements/:id/log', validate(logSupplementSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { date, scheduled_time, status } = req.body;
    const row = await withClient(async c => {
      const own = (await c.query('SELECT 1 FROM saude.supplement WHERE id=$1 AND user_id=$2', [req.params.id, u])).rowCount;
      if (!own) return null;
      return (await c.query(
        `INSERT INTO saude.supplement_log (user_id, supplement_id, taken_on, scheduled_time, status)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, COALESCE($5,'taken')) RETURNING *`,
        [u, req.params.id, date || null, scheduled_time || null, status || null]
      )).rows[0];
    });
    if (!row) return res.status(404).json({ error: 'supplement not found' });
    res.json(row);
  } catch (e) { next(e); }
});

saudeRouter.get('/supplements/log', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const days = Math.min(Number(req.query.days || 30), 365);
    const rows = await withClient(async c => (await c.query(
      `SELECT id, supplement_id, taken_on, taken_at, scheduled_time, status
       FROM saude.supplement_log
       WHERE user_id=$1 AND taken_on >= CURRENT_DATE - ($2::int - 1)
       ORDER BY taken_at DESC`,
      [u, days]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});
