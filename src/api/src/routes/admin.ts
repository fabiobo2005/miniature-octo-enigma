import { Router } from 'express';
import { withClient } from '../db';
import { requireAdmin } from '../middleware/auth';

export const adminRouter = Router();

const userSelect = `id, name, email, role, status, entra_object_id, upn, specialization, bio, active, created_at, updated_at`;
const validRoles = ['aluno', 'personal', 'admin'] as const;
const approvableRoles = ['aluno', 'personal'] as const;
const validStatuses = ['pending', 'active', 'disabled'] as const;

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

async function audit(actorId: string, action: string, targetType: string, targetId: string, details?: Record<string, unknown>) {
  await withClient(async c => {
    await c.query(
      `INSERT INTO app.audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, targetType, targetId, details ? JSON.stringify(details) : null]
    );
  });
}

adminRouter.get('/me', (req, res) => {
  res.json({ user: req.user });
});

adminRouter.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status;
    const role = req.query.role;
    if (status !== undefined && !isOneOf(status, validStatuses)) return res.status(400).json({ error: 'invalid status' });
    if (role !== undefined && !isOneOf(role, validRoles)) return res.status(400).json({ error: 'invalid role' });

    const where: string[] = [];
    const args: unknown[] = [];
    if (status) { args.push(status); where.push(`status = $${args.length}`); }
    if (role) { args.push(role); where.push(`role = $${args.length}`); }

    const rows = await withClient(async c => (await c.query(
      `SELECT ${userSelect}
         FROM app."user"
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC`,
      args
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

adminRouter.get('/users/pending', requireAdmin, async (_req, res, next) => {
  try {
    const rows = await withClient(async c => (await c.query(
      `SELECT ${userSelect}
         FROM app."user"
        WHERE status='pending'
        ORDER BY created_at ASC`
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

adminRouter.post('/users/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const role = req.body?.role;
    if (!isOneOf(role, approvableRoles)) return res.status(400).json({ error: 'invalid role' });

    const row = await withClient(async c => {
      try {
        await c.query('BEGIN');
        const updated = (await c.query(
          `UPDATE app."user"
              SET status='active', role=$2, active=TRUE, updated_at=now()
            WHERE id=$1
            RETURNING ${userSelect}`,
          [req.params.id, role]
        )).rows[0];
        if (!updated) { await c.query('ROLLBACK'); return null; }
        await c.query(
          `INSERT INTO app.audit_log (actor_id, action, target_type, target_id, details)
           VALUES ($1, 'user.approve', 'user', $2, $3)`,
          [req.user!.id, req.params.id, JSON.stringify({ role })]
        );
        await c.query('COMMIT');
        return updated;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });

    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.post('/users/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const row = await setUserStatus(req.params.id, 'disabled');
    if (!row) return res.status(404).json({ error: 'not found' });
    await audit(req.user!.id, 'user.reject', 'user', req.params.id, { reason });
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.post('/users/:id/disable', requireAdmin, async (req, res, next) => {
  try {
    const row = await setUserStatus(req.params.id, 'disabled');
    if (!row) return res.status(404).json({ error: 'not found' });
    await audit(req.user!.id, 'user.disable', 'user', req.params.id);
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.post('/users/:id/enable', requireAdmin, async (req, res, next) => {
  try {
    const row = await setUserStatus(req.params.id, 'active');
    if (!row) return res.status(404).json({ error: 'not found' });
    await audit(req.user!.id, 'user.enable', 'user', req.params.id);
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.patch('/users/:id/role', requireAdmin, async (req, res, next) => {
  try {
    const role = req.body?.role;
    if (!isOneOf(role, validRoles)) return res.status(400).json({ error: 'invalid role' });
    const row = await withClient(async c => (await c.query(
      `UPDATE app."user"
          SET role=$2, updated_at=now()
        WHERE id=$1
        RETURNING ${userSelect}`,
      [req.params.id, role]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    await audit(req.user!.id, 'user.role', 'user', req.params.id, { role });
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.get('/metrics', requireAdmin, async (_req, res, next) => {
  try {
    const data = await withClient(async c => {
      const [users, programs, sessions, pending] = await Promise.all([
        c.query(`SELECT role, status, COUNT(*)::int AS count FROM app."user" GROUP BY role, status ORDER BY role, status`),
        c.query(`SELECT COUNT(*)::int AS count FROM treinos.program WHERE ativo=TRUE`),
        c.query(`SELECT COUNT(*)::int AS count FROM treinos.workout_session WHERE started_at >= now() - interval '30 days'`),
        c.query(`SELECT COUNT(*)::int AS count FROM app."user" WHERE status='pending'`),
      ]);
      return {
        users: users.rows,
        active_programs: programs.rows[0].count,
        sessions_30d: sessions.rows[0].count,
        pending_users: pending.rows[0].count,
      };
    });
    res.json(data);
  } catch (e) { next(e); }
});

adminRouter.get('/audit', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const rows = await withClient(async c => (await c.query(
      `SELECT al.*, u.name AS actor_name, u.email AS actor_email
         FROM app.audit_log al
         LEFT JOIN app."user" u ON u.id = al.actor_id
        ORDER BY al.created_at DESC
        LIMIT $1`,
      [limit]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

// ============ LEADS ============
adminRouter.get('/leads', requireAdmin, async (req, res, next) => {
  try {
    const status = String(req.query.status || 'all');
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const where = status === 'pending' ? 'WHERE contacted_at IS NULL'
                : status === 'contacted' ? 'WHERE contacted_at IS NOT NULL'
                : '';
    const rows = await withClient(async c => (await c.query(
      `SELECT id, name, email, phone, role_interest, profession, message, source, contacted_at, notes, created_at
         FROM app.lead
         ${where}
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    )).rows);
    res.json({ leads: rows });
  } catch (e) { next(e); }
});

adminRouter.post('/leads/:id/contact', requireAdmin, async (req, res, next) => {
  try {
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : null;
    const row = await withClient(async c => (await c.query(
      `UPDATE app.lead
          SET contacted_at = COALESCE(contacted_at, now()),
              notes = COALESCE($2, notes)
        WHERE id = $1
        RETURNING id, contacted_at, notes`,
      [req.params.id, notes]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'lead not found' });
    await audit((req as any).user?.id || '00000000-0000-0000-0000-000000000000', 'lead.contact', 'lead', req.params.id, { notes });
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.post('/leads/:id/reset', requireAdmin, async (req, res, next) => {
  try {
    const row = await withClient(async c => (await c.query(
      `UPDATE app.lead SET contacted_at = NULL WHERE id = $1
        RETURNING id, contacted_at`,
      [req.params.id]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'lead not found' });
    res.json(row);
  } catch (e) { next(e); }
});

adminRouter.delete('/leads/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = await withClient(async c => (await c.query(
      `DELETE FROM app.lead WHERE id=$1 RETURNING id`,
      [req.params.id]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'lead not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});

async function setUserStatus(id: string, status: 'active' | 'disabled') {
  return await withClient(async c => (await c.query(
    `UPDATE app."user"
        SET status=$2, active=($2 = 'active'), updated_at=now()
      WHERE id=$1
      RETURNING ${userSelect}`,
    [id, status]
  )).rows[0]);
}
