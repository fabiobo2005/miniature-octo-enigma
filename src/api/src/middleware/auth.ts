import type { Request, Response, NextFunction } from 'express';
import { withClient } from '../db';

const DEFAULT_TENANT_ID = '5537a00c-2813-4c5c-8422-aa1d3ce1d4ec';
const DEFAULT_CLIENT_ID = '23dfd1f2-389d-4402-ac80-3dad256b7231';

const TENANT_ID = process.env.ENTRA_TENANT_ID || DEFAULT_TENANT_ID;
const CLIENT_ID = process.env.ENTRA_CLIENT_ID || DEFAULT_CLIENT_ID;
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

type JoseModule = typeof import('jose');
const importJose = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<JoseModule>;
let remoteJwks: ReturnType<JoseModule['createRemoteJWKSet']> | undefined;

export type UserRole = 'aluno' | 'personal' | 'admin';
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  name: string;
}

export interface EntraClaims {
  oid: string;
  name?: string;
  upn?: string;
  email?: string;
  preferred_username?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

async function getRemoteJwks() {
  if (remoteJwks) return remoteJwks;
  const { createRemoteJWKSet } = await importJose('jose');
  remoteJwks = createRemoteJWKSet(new URL(JWKS_URL));
  return remoteJwks;
}

export async function verifyEntraToken(token: string): Promise<EntraClaims> {
  const { jwtVerify } = await importJose('jose');
  const { payload } = await jwtVerify(token, await getRemoteJwks(), {
    issuer: ISSUER,
    audience: CLIENT_ID,
  });

  const oid = typeof payload.oid === 'string' ? payload.oid : undefined;
  if (!oid) throw new Error('missing oid claim');

  return {
    oid,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    upn: typeof payload.upn === 'string' ? payload.upn : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    preferred_username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
  };
}

function toAuthenticatedUser(row: any): AuthenticatedUser {
  return {
    id: row.id,
    role: row.role,
    status: row.status || (row.active === false ? 'disabled' : 'active'),
    name: row.name,
  };
}

async function findOrCreateEntraUser(claims: EntraClaims): Promise<AuthenticatedUser> {
  const upn = claims.upn || claims.preferred_username || claims.email || null;
  const email = claims.email || claims.preferred_username || claims.upn || null;
  const name = claims.name || upn || email || 'Novo usuário';

  return await withClient(async c => {
    const existing = (await c.query(
      `SELECT id, name, role, status, active
         FROM app."user"
        WHERE entra_object_id=$1`,
      [claims.oid]
    )).rows[0];

    if (existing) return toAuthenticatedUser(existing);

    if (email) {
      const linked = (await c.query(
        `UPDATE app."user"
            SET entra_object_id=$2,
                upn=COALESCE(upn, $3),
                updated_at=now()
          WHERE lower(email)=lower($1)
            AND entra_object_id IS NULL
          RETURNING id, name, role, status, active`,
        [email, claims.oid, upn]
      )).rows[0];
      if (linked) return toAuthenticatedUser(linked);
    }

    const created = (await c.query(
      `INSERT INTO app."user" (name, email, role, status, entra_object_id, upn)
       VALUES ($1, $2, 'aluno', 'pending', $3, $4)
       ON CONFLICT (entra_object_id) DO UPDATE SET
         upn=COALESCE(app."user".upn, EXCLUDED.upn),
         email=COALESCE(app."user".email, EXCLUDED.email),
         updated_at=now()
       RETURNING id, name, role, status, active`,
      [name, email, claims.oid, upn]
    )).rows[0];

    return toAuthenticatedUser(created);
  });
}

async function findLegacyUser(userId: string): Promise<AuthenticatedUser | null> {
  return await withClient(async c => {
    const row = (await c.query(
      `SELECT id, name, role, status, active
         FROM app."user"
        WHERE id=$1 AND active=TRUE`,
      [userId]
    )).rows[0];
    return row ? toAuthenticatedUser(row) : null;
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header('Authorization');
    let user: AuthenticatedUser | null = null;

    if (auth?.startsWith('Bearer ')) {
      const claims = await verifyEntraToken(auth.slice('Bearer '.length).trim());
      user = await findOrCreateEntraUser(claims);
    } else {
      const legacyUserId = req.header('X-User-Id');
      if (legacyUserId) user = await findLegacyUser(legacyUserId);
    }

    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (user.status === 'disabled') return res.status(403).json({ error: 'user disabled' });

    req.user = user;
    next();
  } catch (e) {
    console.warn('auth failed', e);
    res.status(401).json({ error: 'unauthorized' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export const requireAdmin = requireRole('admin');
