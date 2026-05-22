import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { withClient } from './db';
import { readFileSync } from 'fs';
import { join } from 'path';
import { saudeRouter } from './routes/saude';
import { dietaRouter } from './routes/dieta';
import { treinosRouter } from './routes/treinos';
import { programasRouter } from './routes/programas';
import { usersRouter } from './routes/users';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { requireAuth } from './middleware/auth';

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: false,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-User-Id', 'X-Admin-Secret'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '256kb' }));

function requireAdminSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return res.status(404).json({ error: 'not found' });
  }
  const provided = req.header('X-Admin-Secret') || req.query.key;
  if (provided !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

async function ensureSchema() {
  const candidates = [
    join(__dirname, '..', '..', 'db', 'init.sql'),
    join(__dirname, '..', 'db', 'init.sql'),
    join(process.cwd(), 'db', 'init.sql'),
  ];
  let sql: string | null = null;
  for (const p of candidates) {
    try { sql = readFileSync(p, 'utf8'); break; } catch { /* try next */ }
  }
  if (!sql) { console.warn('schema init.sql not found'); return; }
  await withClient(async c => { await c.query(sql!); });
  console.log('schema ensured (saude, dieta, treinos)');
}

// ============ HEALTH ============
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), version: '3.0.0' });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), version: '3.0.0' });
});

// ============ DB INSPECT (debug - admin only) ============
app.get('/api/db/inspect', requireAdminSecret, async (_req, res, next) => {
  try {
    const data = await withClient(async c => {
      const schemas = (await c.query(
        `SELECT schema_name FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
           AND schema_name NOT LIKE 'pg_%'
         ORDER BY schema_name`
      )).rows.map(r => r.schema_name);

      const tables = (await c.query(
        `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema = ANY($1::text[]) AND table_type='BASE TABLE'
         ORDER BY table_schema, table_name`,
        [schemas]
      )).rows;

      const result: any[] = [];
      for (const t of tables) {
        const cols = (await c.query(
          `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema=$1 AND table_name=$2
           ORDER BY ordinal_position`,
          [t.table_schema, t.table_name]
        )).rows;
        const ident = `"${t.table_schema}"."${t.table_name}"`;
        const count = Number((await c.query(`SELECT count(*)::bigint AS n FROM ${ident}`)).rows[0].n);
        const sample = (await c.query(`SELECT * FROM ${ident} LIMIT 50`)).rows;
        result.push({ schema: t.table_schema, name: t.table_name, count, columns: cols, rows: sample });
      }
      return { schemas, tables: result };
    });
    res.json(data);
  } catch (e) { next(e); }
});

// ============ PUBLIC ROUTERS ============
app.use('/api/auth', authRouter);

// ============ AUTHENTICATED ROUTERS ============
app.use(requireAuth);
app.use('/api/admin',   adminRouter);
app.use('/api/users',   usersRouter);
app.use('/api/saude',   saudeRouter);
app.use('/api/dieta',   dietaRouter);
app.use('/api/treinos', treinosRouter);
app.use('/api/treinos', programasRouter);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('unhandled', err);
  res.status(500).json({ error: err?.message || 'internal error' });
});

const port = Number(process.env.PORT || 3000);
ensureSchema().catch(e => console.error('schema init failed', e));
app.listen(port, () => console.log(`apex-api listening on :${port}`));
