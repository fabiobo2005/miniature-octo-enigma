import { Router } from 'express';
import { withClient } from '../db';

export const authRouter = Router();

const VALID_PROFESSIONS = ['personal_trainer','nutricionista','fisioterapeuta','psicologo','medico','educador_fisico','outro'];

function cleanString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function normProfession(v: unknown): string | null {
  const s = cleanString(v, 40);
  if (!s) return null;
  return VALID_PROFESSIONS.includes(s) ? s : 'outro';
}

authRouter.post('/register-personal', async (req, res, next) => {
  try {
    const name = cleanString(req.body?.name, 100);
    const email = cleanString(req.body?.email, 200);
    const specialization = cleanString(req.body?.specialization, 200);
    const bio = cleanString(req.body?.bio, 2000);
    const entraObjectId = cleanString(req.body?.entra_object_id, 100);
    const profession = normProfession(req.body?.profession) || 'personal_trainer';

    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    const row = await withClient(async c => (await c.query(
      `INSERT INTO app."user" (name, email, role, status, specialization, bio, entra_object_id, upn, profession)
       VALUES ($1, $2, 'personal', 'pending', $3, $4, $5, $2, $6)
       RETURNING id, status`,
      [name, email, specialization, bio, entraObjectId, profession]
    )).rows[0]);

    res.status(201).json({ id: row.id, status: row.status });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'user already exists' });
    next(e);
  }
});

// Lead capture from landing page (no auth required).
authRouter.post('/register-lead', async (req, res, next) => {
  try {
    const name = cleanString(req.body?.name, 100);
    const email = cleanString(req.body?.email, 200);
    const phone = cleanString(req.body?.phone, 30);
    const message = cleanString(req.body?.message, 1000);
    const rawRole = cleanString(req.body?.role_interest, 20);
    const source = cleanString(req.body?.source, 100) || 'landing';
    const roleInterest = rawRole && ['aluno','personal','outro'].includes(rawRole) ? rawRole : 'aluno';
    const profession = normProfession(req.body?.profession);

    if (!name || !email || !isEmail(email)) {
      return res.status(400).json({ error: 'name and valid email required' });
    }

    const ip = (req.header('x-forwarded-for')?.split(',')[0] || req.ip || '').slice(0, 64);
    const userAgent = (req.header('user-agent') || '').slice(0, 250);

    const row = await withClient(async c => (await c.query(
      `INSERT INTO app.lead (name, email, phone, role_interest, profession, message, source, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at`,
      [name, email, phone, roleInterest, profession, message, source, ip, userAgent]
    )).rows[0]);

    res.status(201).json({ id: row.id, created_at: row.created_at });
  } catch (e) { next(e); }
});

// Public list of active professionals for landing page.
async function listPublicProfessionals(_req: any, res: any, next: any) {
  try {
    const rows = await withClient(async c => (await c.query(
      `SELECT id, name, specialization, bio, profession
         FROM app."user"
        WHERE role = 'personal'
          AND status = 'active'
          AND active = TRUE
        ORDER BY name
        LIMIT 50`
    )).rows);
    res.json({ personals: rows, professionals: rows });
  } catch (e) { next(e); }
}
authRouter.get('/public/personals', listPublicProfessionals);
authRouter.get('/public/professionals', listPublicProfessionals);
