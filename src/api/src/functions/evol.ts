import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { withClient } from '../db';

const json = (status: number, body: unknown): HttpResponseInit => ({
  status,
  jsonBody: body
});

// GET /api/evol — list all entries (most recent first)
app.http('evol-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'evol',
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const rows = await withClient(async c => {
        const r = await c.query('SELECT * FROM evolution ORDER BY measured_on DESC');
        return r.rows;
      });
      return json(200, rows);
    } catch (e: any) {
      ctx.error('evol-list failed', e);
      return json(500, { error: e.message });
    }
  }
});

// PUT /api/evol — upsert by measured_on
app.http('evol-upsert', {
  methods: ['PUT', 'POST'],
  authLevel: 'anonymous',
  route: 'evol',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await req.json() as any;
      if (!body?.d) return json(400, { error: 'missing field: d (measured_on)' });
      const row = await withClient(async c => {
        const r = await c.query(
          `INSERT INTO evolution
            (measured_on, peso, bf, mm, visc, agua, mskel, gsub, osso, prot, tmb, idade_corpo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (measured_on) DO UPDATE SET
            peso=EXCLUDED.peso, bf=EXCLUDED.bf, mm=EXCLUDED.mm,
            visc=EXCLUDED.visc, agua=EXCLUDED.agua, mskel=EXCLUDED.mskel,
            gsub=EXCLUDED.gsub, osso=EXCLUDED.osso, prot=EXCLUDED.prot,
            tmb=EXCLUDED.tmb, idade_corpo=EXCLUDED.idade_corpo,
            updated_at=now()
           RETURNING *`,
          [
            body.d, body.p ?? null, body.bf ?? null, body.mm ?? null,
            body.visc ?? null, body.agua ?? null, body.mskel ?? null,
            body.gsub ?? null, body.osso ?? null, body.prot ?? null,
            body.tmb ?? null, body.idade ?? null
          ]
        );
        return r.rows[0];
      });
      return json(200, row);
    } catch (e: any) {
      ctx.error('evol-upsert failed', e);
      return json(500, { error: e.message });
    }
  }
});

// DELETE /api/evol/{date}
app.http('evol-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'evol/{date}',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const date = req.params.date;
      const ok = await withClient(async c => {
        const r = await c.query('DELETE FROM evolution WHERE measured_on = $1', [date]);
        return (r.rowCount ?? 0) > 0;
      });
      return json(ok ? 204 : 404, ok ? null : { error: 'not found' });
    } catch (e: any) {
      ctx.error('evol-delete failed', e);
      return json(500, { error: e.message });
    }
  }
});
