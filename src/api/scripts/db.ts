// Database helper for CLI scripts.
// Strategy: prefer PG_PASSWORD/DATABASE_URL for local/dev runs; otherwise
// fall back to the Azure AD token flow used by the API (DefaultAzureCredential).
import { Pool, PoolClient } from 'pg';

let pool: Pool | undefined;

async function makePool(): Promise<Pool> {
  const host = process.env.PG_HOST;
  const port = Number(process.env.PG_PORT || 5432);
  const database = process.env.PG_DATABASE;
  const user = process.env.PG_USER;
  const ssl = process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false;

  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
      max: 4,
    });
  }

  if (process.env.PG_PASSWORD) {
    return new Pool({ host, port, database, user, password: process.env.PG_PASSWORD, ssl, max: 2, keepAlive: true, idleTimeoutMillis: 30000, connectionTimeoutMillis: 30000 } as any);
  }

  // Azure AD token (same as src/db.ts)
  const { DefaultAzureCredential } = await import('@azure/identity');
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID,
  });
  const SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';
  return new Pool({
    host, port, database, user,
    password: async () => {
      const t = await credential.getToken(SCOPE);
      if (!t) throw new Error('Failed to acquire Postgres access token');
      return t.token;
    },
    ssl: { rejectUnauthorized: true },
    max: 4,
  } as any);
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = await makePool();
    pool.on('error', (err) => {
      console.error('[pool] idle client error:', err.message);
    });
  }
  return pool;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const p = await getPool();
  const c = await p.connect();
  try { return await fn(c); } finally { c.release(); }
}

export async function endPool(): Promise<void> {
  if (pool) { await pool.end(); pool = undefined; }
}
