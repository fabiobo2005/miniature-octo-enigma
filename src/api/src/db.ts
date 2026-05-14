import { DefaultAzureCredential } from '@azure/identity';
import { Pool, PoolClient } from 'pg';

let pool: Pool | undefined;
const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID
});
const SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

async function getToken(): Promise<string> {
  const t = await credential.getToken(SCOPE);
  if (!t) throw new Error('Failed to acquire Postgres access token');
  return t.token;
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: async () => getToken(),
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : false,
    max: 4,
    idleTimeoutMillis: 30000
  } as any);
  return pool;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const p = await getPool();
  const c = await p.connect();
  try { return await fn(c); } finally { c.release(); }
}
