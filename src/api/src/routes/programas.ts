// Fase 3 — APIs de Programas de Treino, Sessões, Execuções, Timers e Áudio.
//
// Convenções
// - Auth: header `X-User-Id` (UUID em app.user). Mesmo padrão das demais rotas.
// - Catálogo de programas/exercícios é compartilhado entre usuários; sessões,
//   execuções, timer_preset e audio_cue_profile são por usuário.
// - Coach: rotas anotadas com [coach] exigem que o user atual seja
//   coach_user_id em treinos.coach_assignment com status='ativo' apontando
//   para o aluno alvo.

import { Router, Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withClient } from '../db';
import { validate } from '../middleware/validate';
import { uuid, positiveInt } from '../schemas/common';

export const programasRouter = Router();

function requireUid(req: Request, res: Response): string | null {
  const v = (req.query.user_id || req.body?.user_id || req.headers['x-user-id']) as string | undefined;
  if (!v) { res.status(400).json({ error: 'user_id required' }); return null; }
  return String(v);
}

async function assertCoachOf(coachUid: string, alunoUid: string): Promise<boolean> {
  if (coachUid === alunoUid) return true;
  return await withClient(async c => {
    const r = await c.query(
      `SELECT 1 FROM treinos.coach_assignment
        WHERE coach_user_id=$1 AND aluno_user_id=$2 AND status='ativo' LIMIT 1`,
      [coachUid, alunoUid]
    );
    return (r.rowCount ?? 0) > 0;
  });
}

// =============================================================================
// PROGRAMAS — catálogo
// =============================================================================

const listProgramasQuery = z.object({
  nivel: z.enum(['iniciante','intermediario','avancado']).optional(),
  ativo: z.enum(['true','false']).optional(),
  q: z.string().max(80).optional(),
});

programasRouter.get('/programas', validate(listProgramasQuery, 'query'), async (req, res, next) => {
  try {
    const q = (req as any).validatedQuery as z.infer<typeof listProgramasQuery>;
    const where: string[] = [];
    const args: any[] = [];
    if (q.nivel) { args.push(q.nivel); where.push(`nivel = $${args.length}`); }
    if (q.ativo) { args.push(q.ativo === 'true'); where.push(`ativo = $${args.length}`); }
    if (q.q)     { args.push(`%${q.q.toLowerCase()}%`); where.push(`lower(nome) LIKE $${args.length}`); }
    const sql = `SELECT p.id, p.nome, p.nivel, p.objetivo, p.duracao_semanas, p.ativo,
                        p.autor_user_id, p.created_at, p.updated_at,
                        (SELECT COUNT(*)::int FROM treinos.workout_template wt WHERE wt.program_id = p.id) AS templates_count
                   FROM treinos.program p
                  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY (nivel='iniciante') DESC, (nivel='intermediario') DESC, nome`;
    const rows = await withClient(async c => (await c.query(sql, args)).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.get('/programas/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const data = await withClient(async c => {
      const prog = (await c.query(`SELECT * FROM treinos.program WHERE id=$1`, [id])).rows[0];
      if (!prog) return null;
      const templates = (await c.query(
        `SELECT id, semana_numero, cor, nome_treino, ordem, observacoes,
                (SELECT COUNT(*)::int FROM treinos.exercise_prescription ep WHERE ep.workout_template_id = wt.id) AS exercicios_count
           FROM treinos.workout_template wt
          WHERE program_id=$1
          ORDER BY semana_numero, cor, ordem, id`,
        [id]
      )).rows;
      const semanas: Record<number, any> = {};
      for (const t of templates) {
        if (!semanas[t.semana_numero]) semanas[t.semana_numero] = { semana_numero: t.semana_numero, templates: [] };
        semanas[t.semana_numero].templates.push(t);
      }
      return { ...prog, semanas: Object.values(semanas) };
    });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch (e) { next(e); }
});

programasRouter.get('/programas/:id/templates/:templateId', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tid = Number(req.params.templateId);
    if (!Number.isInteger(id) || !Number.isInteger(tid)) return res.status(400).json({ error: 'invalid id' });
    const data = await withClient(async c => {
      const tpl = (await c.query(
        `SELECT * FROM treinos.workout_template WHERE id=$1 AND program_id=$2`,
        [tid, id]
      )).rows[0];
      if (!tpl) return null;
      const exercicios = (await c.query(
        `SELECT ep.id, ep.ordem, ep.series, ep.reps, ep.cadencia, ep.intervalo_seg,
                ep.metodo, ep.observacoes, ep.carga_sugerida, ep.nome_original,
                ec.id AS exercise_id, ec.nome_padrao AS exercise_nome, ec.grupo_muscular,
                ec.equipamento,
                (SELECT jsonb_agg(jsonb_build_object('tipo', em.tipo, 'url', em.url, 'titulo', em.titulo)
                                  ORDER BY em.id)
                   FROM treinos.exercise_media em WHERE em.exercise_catalog_id = ec.id) AS media
           FROM treinos.exercise_prescription ep
           JOIN treinos.exercise_catalog ec ON ec.id = ep.exercise_catalog_id
          WHERE ep.workout_template_id = $1
          ORDER BY ep.ordem, ep.id`,
        [tid]
      )).rows;
      return { ...tpl, exercicios };
    });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch (e) { next(e); }
});

// =============================================================================
// EXERCISES — catálogo
// =============================================================================

programasRouter.get('/exercises/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const data = await withClient(async c => {
      const ex = (await c.query(`SELECT * FROM treinos.exercise_catalog WHERE id=$1`, [id])).rows[0];
      if (!ex) return null;
      const aliases = (await c.query(
        `SELECT alias, origem FROM treinos.exercise_alias WHERE exercise_catalog_id=$1 ORDER BY alias`,
        [id]
      )).rows;
      const media = (await c.query(
        `SELECT id, tipo, url, titulo FROM treinos.exercise_media WHERE exercise_catalog_id=$1 ORDER BY id`,
        [id]
      )).rows;
      return { ...ex, aliases, media };
    });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch (e) { next(e); }
});

// =============================================================================
// SESSIONS — execução pelo aluno
// =============================================================================

const startSessionSchema = z.object({
  workout_template_id: positiveInt,
  semana_numero: positiveInt.optional(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

programasRouter.post('/sessions', validate(startSessionSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const body = req.body as z.infer<typeof startSessionSchema>;
    const session = await withClient(async c => {
      const tpl = (await c.query(
        `SELECT id, program_id, semana_numero FROM treinos.workout_template WHERE id=$1`,
        [body.workout_template_id]
      )).rows[0];
      if (!tpl) return null;
      try {
        await c.query('BEGIN');
        const ses = (await c.query(
          `INSERT INTO treinos.workout_session
             (user_id, program_id, workout_template_id, semana_numero, data, status)
           VALUES ($1,$2,$3,$4, COALESCE($5::date, CURRENT_DATE), 'in_progress')
           RETURNING *`,
          [u, tpl.program_id, tpl.id, body.semana_numero ?? tpl.semana_numero, body.data ?? null]
        )).rows[0];
        // gera executions a partir das prescrições
        await c.query(
          `INSERT INTO treinos.exercise_execution
             (workout_session_id, exercise_catalog_id, prescription_id, ordem)
           SELECT $1, ep.exercise_catalog_id, ep.id, ep.ordem
             FROM treinos.exercise_prescription ep
            WHERE ep.workout_template_id = $2
            ORDER BY ep.ordem`,
          [ses.id, tpl.id]
        );
        await c.query('COMMIT');
        return ses;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    if (!session) return res.status(404).json({ error: 'template not found' });
    res.status(201).json(session);
  } catch (e) { next(e); }
});

programasRouter.get('/sessions', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const status = (req.query.status as string | undefined);
    const limit = Math.min(Number(req.query.limit || 30), 200);
    const where = ['user_id = $1'];
    const args: any[] = [u];
    if (status && ['in_progress','finished','aborted'].includes(status)) {
      args.push(status); where.push(`status = $${args.length}`);
    }
    args.push(limit);
    const rows = await withClient(async c => (await c.query(
      `SELECT s.*, p.nome AS program_nome, wt.nome_treino, wt.cor
         FROM treinos.workout_session s
         LEFT JOIN treinos.program p ON p.id = s.program_id
         LEFT JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.data DESC, s.started_at DESC
        LIMIT $${args.length}`,
      args
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const data = await withClient(async c => {
      const s = (await c.query(
        `SELECT s.*, p.nome AS program_nome, wt.nome_treino, wt.cor
           FROM treinos.workout_session s
           LEFT JOIN treinos.program p ON p.id = s.program_id
           LEFT JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
          WHERE s.id=$1 AND s.user_id=$2`,
        [id, u]
      )).rows[0];
      if (!s) return null;
      const execs = (await c.query(
        `SELECT ee.id, ee.ordem, ee.concluido, ee.observacao_aluno,
                ee.exercise_catalog_id, ec.nome_padrao AS exercise_nome, ec.grupo_muscular,
                ee.prescription_id,
                ep.series, ep.reps, ep.cadencia, ep.intervalo_seg, ep.metodo,
                ep.carga_sugerida, ep.nome_original,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                      'id', se.id, 'set_numero', se.set_numero, 'reps', se.reps,
                      'carga', se.carga, 'rpe', se.rpe, 'tempo_seg', se.tempo_seg,
                      'observacoes', se.observacoes, 'registered_at', se.registered_at
                    ) ORDER BY se.set_numero)
                     FROM treinos.set_execution se WHERE se.exercise_execution_id = ee.id),
                  '[]'::json
                ) AS sets
           FROM treinos.exercise_execution ee
           JOIN treinos.exercise_catalog ec ON ec.id = ee.exercise_catalog_id
           LEFT JOIN treinos.exercise_prescription ep ON ep.id = ee.prescription_id
          WHERE ee.workout_session_id = $1
          ORDER BY ee.ordem, ee.id`,
        [id]
      )).rows;
      return { ...s, exercicios: execs };
    });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch (e) { next(e); }
});

const patchSessionSchema = z.object({
  status: z.enum(['in_progress','finished','aborted']).optional(),
  pse: z.number().int().min(0).max(10).optional().nullable(),
  unidades_arbitrarias: z.number().nonnegative().optional().nullable(),
  carga_total: z.number().nonnegative().optional().nullable(),
  duracao_min: z.number().int().nonnegative().max(720).optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
  finished_at: z.string().datetime().optional().nullable(),
});

programasRouter.patch('/sessions/:id', validate(patchSessionSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const b = req.body as z.infer<typeof patchSessionSchema>;
    const row = await withClient(async c => (await c.query(
      `UPDATE treinos.workout_session SET
         status              = COALESCE($3, status),
         pse                 = COALESCE($4, pse),
         unidades_arbitrarias= COALESCE($5, unidades_arbitrarias),
         carga_total         = COALESCE($6, carga_total),
         duracao_min         = COALESCE($7, duracao_min),
         observacoes         = COALESCE($8, observacoes),
         finished_at         = COALESCE($9::timestamptz,
                                        CASE WHEN $3 IN ('finished','aborted') AND finished_at IS NULL
                                             THEN now() ELSE finished_at END),
         updated_at          = now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id, u, b.status ?? null, b.pse ?? null, b.unidades_arbitrarias ?? null,
       b.carga_total ?? null, b.duracao_min ?? null, b.observacoes ?? null, b.finished_at ?? null]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

// ---------- Executions (marcar concluído / observação) ----------
const patchExecutionSchema = z.object({
  concluido: z.boolean().optional(),
  observacao_aluno: z.string().max(1000).optional().nullable(),
});

programasRouter.patch('/executions/:id', validate(patchExecutionSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const b = req.body as z.infer<typeof patchExecutionSchema>;
    const row = await withClient(async c => (await c.query(
      `UPDATE treinos.exercise_execution ee SET
         concluido       = COALESCE($3, ee.concluido),
         observacao_aluno= COALESCE($4, ee.observacao_aluno),
         updated_at      = now()
       FROM treinos.workout_session s
       WHERE ee.id=$1 AND ee.workout_session_id = s.id AND s.user_id=$2
       RETURNING ee.*`,
      [id, u, b.concluido ?? null, b.observacao_aluno ?? null]
    )).rows[0]);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { next(e); }
});

// ---------- Sets ----------
const upsertSetSchema = z.object({
  exercise_execution_id: positiveInt,
  set_numero: z.number().int().min(1).max(50),
  reps: z.number().int().nonnegative().max(999).optional().nullable(),
  carga: z.number().nonnegative().max(9999.99).optional().nullable(),
  rpe: z.number().min(0).max(10).optional().nullable(),
  tempo_seg: z.number().int().nonnegative().max(86400).optional().nullable(),
  observacoes: z.string().max(500).optional().nullable(),
});

programasRouter.post('/sets', validate(upsertSetSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const b = req.body as z.infer<typeof upsertSetSchema>;
    const row = await withClient(async c => {
      // garante ownership
      const ok = (await c.query(
        `SELECT 1 FROM treinos.exercise_execution ee
            JOIN treinos.workout_session s ON s.id = ee.workout_session_id
          WHERE ee.id=$1 AND s.user_id=$2`,
        [b.exercise_execution_id, u]
      )).rowCount;
      if (!ok) return null;
      return (await c.query(
        `INSERT INTO treinos.set_execution
           (exercise_execution_id, set_numero, reps, carga, rpe, tempo_seg, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (exercise_execution_id, set_numero) DO UPDATE
           SET reps=EXCLUDED.reps, carga=EXCLUDED.carga, rpe=EXCLUDED.rpe,
               tempo_seg=EXCLUDED.tempo_seg, observacoes=EXCLUDED.observacoes,
               registered_at = now()
         RETURNING *`,
        [b.exercise_execution_id, b.set_numero, b.reps ?? null, b.carga ?? null,
         b.rpe ?? null, b.tempo_seg ?? null, b.observacoes ?? null]
      )).rows[0];
    });
    if (!row) return res.status(404).json({ error: 'execution not found' });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

programasRouter.delete('/sets/:id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const ok = await withClient(async c => {
      const r = await c.query(
        `DELETE FROM treinos.set_execution se
          USING treinos.exercise_execution ee, treinos.workout_session s
          WHERE se.id=$1 AND se.exercise_execution_id=ee.id
            AND ee.workout_session_id=s.id AND s.user_id=$2`,
        [id, u]
      );
      return (r.rowCount ?? 0) > 0;
    });
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// =============================================================================
// ME — atalhos do aluno
// =============================================================================

const createProgramAssignSchema = z.object({
  program_id: positiveInt,
  coach_user_id: uuid.optional(),
});

function nextNivel(nivel: string): string {
  if (nivel === 'iniciante') return 'intermediario';
  if (nivel === 'intermediario') return 'avancado';
  return 'avancado';
}

async function suggestNextPrograms(c: PoolClient, currentProgramId: number, nivel: string): Promise<any[]> {
  const acima = nextNivel(nivel);
  return (await c.query(
    `WITH mesmo AS (
       SELECT id AS program_id, nome, nivel, 'Continuar no nível ' || nivel AS motivo
         FROM treinos.program
        WHERE ativo = TRUE AND id <> $1 AND nivel = $2
        ORDER BY nome
        LIMIT 3
     ), acima AS (
       SELECT id AS program_id, nome, nivel, 'Subir para nível ' || nivel AS motivo
         FROM treinos.program
        WHERE ativo = TRUE AND id <> $1 AND nivel = $3
        ORDER BY nome
        LIMIT 2
     )
     SELECT * FROM mesmo
     UNION ALL
     SELECT * FROM acima`,
    [currentProgramId, nivel, acima]
  )).rows;
}

function shapeAssignment(row: any): any {
  return {
    id: row.id,
    aluno_user_id: row.aluno_user_id,
    program_id: row.program_id,
    coach_user_id: row.coach_user_id,
    source: row.source,
    started_on: row.started_on,
    ended_on: row.ended_on,
    status: row.status,
    observacoes: row.observacoes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function hasProgramAssignmentSource(c: PoolClient): Promise<boolean> {
  const row = (await c.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema='treinos'
        AND table_name='program_assignment'
        AND column_name='source'
      LIMIT 1`
  )).rows[0];
  return !!row;
}

programasRouter.post('/me/assignments', validate(createProgramAssignSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const b = req.body as z.infer<typeof createProgramAssignSchema>;
    const data = await withClient(async c => {
      const program = (await c.query(
        `SELECT id, nome, nivel, duracao_semanas FROM treinos.program WHERE id=$1 AND ativo=TRUE`,
        [b.program_id]
      )).rows[0];
      if (!program) return null;
      const coachUserId = b.coach_user_id ?? null;
      const source = b.coach_user_id ? 'coach' : 'self';
      const hasSource = await hasProgramAssignmentSource(c);
      await c.query('BEGIN');
      try {
        await c.query(
          `UPDATE treinos.program_assignment
              SET status='encerrado', ended_on=CURRENT_DATE, updated_at=now()
            WHERE aluno_user_id=$1 AND status='ativo'`,
          [u]
        );
        const assignment = (await c.query(
          hasSource
            ? `INSERT INTO treinos.program_assignment
                 (aluno_user_id, program_id, coach_user_id, source, status)
               VALUES ($1,$2,$3,$4,'ativo')
               RETURNING *`
            : `INSERT INTO treinos.program_assignment
                 (aluno_user_id, program_id, coach_user_id, status)
               VALUES ($1,$2,$3,'ativo')
               RETURNING *`,
          hasSource ? [u, b.program_id, coachUserId, source] : [u, b.program_id, coachUserId]
        )).rows[0];
        await c.query('COMMIT');
        return { assignment, program };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    if (!data) return res.status(404).json({ error: 'program not found or inactive' });
    res.status(201).json(data);
  } catch (e) { next(e); }
});

programasRouter.get('/me/assignment-ativo', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const row = await withClient(async c => {
      const hasSource = await hasProgramAssignmentSource(c);
      return (await c.query(
        `SELECT pa.*, ${hasSource ? 'pa.source' : "'self'::text AS source"},
                p.nome AS program_nome, p.nivel AS program_nivel, p.objetivo AS program_objetivo,
                p.duracao_semanas, p.ativo AS program_ativo
           FROM treinos.program_assignment pa
           JOIN treinos.program p ON p.id = pa.program_id
          WHERE pa.aluno_user_id=$1 AND pa.status='ativo'
          ORDER BY pa.started_on DESC, pa.id DESC
          LIMIT 1`,
        [u]
      )).rows[0];
    });
    if (!row) return res.json({ assignment: null, program: null });
    res.json({
      assignment: shapeAssignment(row),
      program: {
        id: row.program_id,
        nome: row.program_nome,
        nivel: row.program_nivel,
        objetivo: row.program_objetivo,
        duracao_semanas: row.duracao_semanas,
        ativo: row.program_ativo,
      },
    });
  } catch (e) { next(e); }
});

programasRouter.get('/me/assignments/atual', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const row = await withClient(async c => (await c.query(
      `SELECT pa.*, p.nome AS program_nome, p.nivel AS program_nivel, p.duracao_semanas,
              cu.id AS coach_id, cu.name AS coach_name, cu.goal AS coach_goal, cu.role AS coach_role,
              GREATEST(CURRENT_DATE - pa.started_on, 0)::int AS dias_no_programa,
              LEAST(GREATEST(FLOOR(GREATEST(CURRENT_DATE - pa.started_on, 0) / 7.0)::int + 1, 1), p.duracao_semanas)::int AS semana_atual,
              LEAST(100, GREATEST(0, ROUND((GREATEST(CURRENT_DATE - pa.started_on, 0)::numeric / NULLIF(p.duracao_semanas * 7, 0)) * 100)))::int AS pct
         FROM treinos.program_assignment pa
         JOIN treinos.program p ON p.id = pa.program_id
         LEFT JOIN app.user cu ON cu.id = pa.coach_user_id
        WHERE pa.aluno_user_id=$1 AND pa.status='ativo'
        ORDER BY pa.started_on DESC, pa.id DESC
        LIMIT 1`,
      [u]
    )).rows[0]);
    if (!row) return res.json({ assignment: null });
    res.json({
      assignment: shapeAssignment(row),
      program: { id: row.program_id, nome: row.program_nome, nivel: row.program_nivel, duracao_semanas: row.duracao_semanas },
      coach: row.coach_id ? { id: row.coach_id, name: row.coach_name, goal: row.coach_goal, role: row.coach_role } : null,
      progress: { dias_no_programa: row.dias_no_programa, semana_atual: row.semana_atual, pct: row.pct },
    });
  } catch (e) { next(e); }
});

programasRouter.get('/me/assignments', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const rows = await withClient(async c => (await c.query(
      `SELECT pa.*, p.nome AS program_nome, p.nivel AS program_nivel, p.duracao_semanas
         FROM treinos.program_assignment pa
         JOIN treinos.program p ON p.id = pa.program_id
        WHERE pa.aluno_user_id=$1
        ORDER BY pa.started_on DESC, pa.id DESC`,
      [u]
    )).rows.map(row => ({
      assignment: shapeAssignment(row),
      program: { id: row.program_id, nome: row.program_nome, nivel: row.program_nivel, duracao_semanas: row.duracao_semanas },
    })));
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.delete('/me/assignments/atual', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    await withClient(async c => { await c.query(
      `UPDATE treinos.program_assignment
          SET status='cancelado', ended_on=CURRENT_DATE, updated_at=now()
        WHERE aluno_user_id=$1 AND status='ativo'`,
      [u]
    ); });
    res.status(204).end();
  } catch (e) { next(e); }
});

programasRouter.patch('/me/assignments/atual/concluir', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const data = await withClient(async c => {
      const row = (await c.query(
        `UPDATE treinos.program_assignment pa
            SET status='concluido', ended_on=CURRENT_DATE, updated_at=now()
           FROM treinos.program p
          WHERE pa.program_id=p.id AND pa.aluno_user_id=$1 AND pa.status='ativo'
          RETURNING pa.*, p.nome AS program_nome, p.nivel AS program_nivel, p.duracao_semanas`,
        [u]
      )).rows[0];
      if (!row) return null;
      const sugestoes = await suggestNextPrograms(c, row.program_id, row.program_nivel);
      return {
        assignment: shapeAssignment(row),
        program: { id: row.program_id, nome: row.program_nome, nivel: row.program_nivel, duracao_semanas: row.duracao_semanas },
        sugestoes,
      };
    });
    if (!data) return res.status(404).json({ error: 'active assignment not found' });
    res.json(data);
  } catch (e) { next(e); }
});

programasRouter.get('/me/proximo-treino', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const data = await withClient(async c => {
      const row = (await c.query(
        `SELECT pa.*, p.nome AS program_nome, p.nivel AS program_nivel, p.duracao_semanas,
                GREATEST(CURRENT_DATE - pa.started_on, 0)::int AS dias_no_programa,
                LEAST(GREATEST(FLOOR(GREATEST(CURRENT_DATE - pa.started_on, 0) / 7.0)::int + 1, 1), p.duracao_semanas)::int AS semana_atual
           FROM treinos.program_assignment pa
           JOIN treinos.program p ON p.id = pa.program_id
          WHERE pa.aluno_user_id=$1 AND pa.status='ativo'
          ORDER BY pa.started_on DESC, pa.id DESC
          LIMIT 1`,
        [u]
      )).rows[0];
      if (!row) return { status: 'sem-programa' };

      const templates = (await c.query(
        `SELECT wt.id, wt.cor, wt.nome_treino, wt.ordem, wt.semana_numero,
                (SELECT COUNT(*)::int FROM treinos.exercise_prescription ep WHERE ep.workout_template_id = wt.id) AS exercicios_count
           FROM treinos.workout_template wt
          WHERE wt.program_id=$1 AND wt.semana_numero=$2
          ORDER BY wt.ordem, wt.id`,
        [row.program_id, row.semana_atual]
      )).rows;

      const sessaoAnterior = (await c.query(
        `SELECT s.id, s.workout_template_id, s.started_at, s.finished_at,
                wt.cor, wt.nome_treino, wt.ordem, wt.semana_numero
           FROM treinos.workout_session s
           JOIN treinos.workout_template wt ON wt.id = s.workout_template_id AND wt.program_id = $2
          WHERE s.user_id=$1 AND (s.status IN ('finished','concluido') OR s.finished_at IS NOT NULL)
          ORDER BY COALESCE(s.finished_at, s.started_at) DESC, s.data DESC, s.id DESC
          LIMIT 1`,
        [u, row.program_id]
      )).rows[0] ?? null;

      const concluidoAtual = (await c.query(
        `SELECT DISTINCT s.workout_template_id
           FROM treinos.workout_session s
           JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
          WHERE s.user_id=$1 AND wt.program_id=$2 AND wt.semana_numero=$3
            AND (s.status IN ('finished','concluido') OR s.finished_at IS NOT NULL)`,
        [u, row.program_id, row.semana_atual]
      )).rows.map(r => r.workout_template_id);
      const concluidos = new Set<number>(concluidoAtual);
      const todosDaSemanaConcluidos = templates.length > 0 && templates.every(t => concluidos.has(t.id));
      let status = 'pronto';
      let proximoTemplate = templates[0] ?? null;
      let sugestoes: any[] = [];

      if (row.semana_atual === row.duracao_semanas && todosDaSemanaConcluidos) {
        status = 'programa-concluido';
        proximoTemplate = null;
        sugestoes = await suggestNextPrograms(c, row.program_id, row.program_nivel);
      } else if (concluidos.size === 0) {
        proximoTemplate = templates[0] ?? null;
      } else if (sessaoAnterior?.semana_numero === row.semana_atual) {
        proximoTemplate = templates.find(t => t.ordem > sessaoAnterior.ordem) ?? null;
        if (!proximoTemplate) {
          status = 'semana-completa';
          proximoTemplate = (await c.query(
            `SELECT wt.id, wt.cor, wt.nome_treino, wt.ordem, wt.semana_numero,
                    (SELECT COUNT(*)::int FROM treinos.exercise_prescription ep WHERE ep.workout_template_id = wt.id) AS exercicios_count
               FROM treinos.workout_template wt
              WHERE wt.program_id=$1 AND wt.semana_numero=$2
              ORDER BY wt.ordem, wt.id
              LIMIT 1`,
            [row.program_id, row.semana_atual + 1]
          )).rows[0] ?? null;
        }
      } else {
        proximoTemplate = templates[0] ?? null;
      }

      return {
        status,
        assignment: shapeAssignment(row),
        program: { id: row.program_id, nome: row.program_nome, nivel: row.program_nivel, duracao_semanas: row.duracao_semanas },
        semana_atual: row.semana_atual,
        dias_no_programa: row.dias_no_programa,
        proximo_template: proximoTemplate,
        sessao_anterior: sessaoAnterior ? {
          id: sessaoAnterior.id,
          workout_template_id: sessaoAnterior.workout_template_id,
          started_at: sessaoAnterior.started_at,
          finished_at: sessaoAnterior.finished_at,
          cor: sessaoAnterior.cor,
          nome_treino: sessaoAnterior.nome_treino,
        } : null,
        sugestoes,
      };
    });
    res.json(data);
  } catch (e) { next(e); }
});

// =============================================================================
// COACH — atribuições e feedback
// =============================================================================

const createCoachAssignSchema = z.object({
  aluno_user_id: uuid,
  observacoes: z.string().max(1000).optional().nullable(),
});

programasRouter.get('/coach/alunos', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const rows = await withClient(async c => (await c.query(
      `SELECT ca.id AS assignment_id, ca.status, ca.started_on, ca.observacoes,
              au.id AS aluno_id, au.name AS aluno_nome, au.email AS aluno_email
         FROM treinos.coach_assignment ca
         JOIN app.user au ON au.id = ca.aluno_user_id
        WHERE ca.coach_user_id=$1
        ORDER BY (ca.status='ativo') DESC, au.name`,
      [u]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.post('/coach/alunos', validate(createCoachAssignSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const { aluno_user_id, observacoes } = req.body as z.infer<typeof createCoachAssignSchema>;
    if (aluno_user_id === u) return res.status(400).json({ error: 'coach cannot be aluno' });
    const row = await withClient(async c => (await c.query(
      `INSERT INTO treinos.coach_assignment (coach_user_id, aluno_user_id, observacoes)
       VALUES ($1,$2,$3)
       ON CONFLICT (coach_user_id, aluno_user_id) WHERE status='ativo' DO NOTHING
       RETURNING *`,
      [u, aluno_user_id, observacoes ?? null]
    )).rows[0]);
    if (!row) return res.status(409).json({ error: 'already assigned (ativo)' });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

const createFeedbackSchema = z.object({
  aluno_user_id: uuid,
  workout_session_id: positiveInt.optional().nullable(),
  texto: z.string().min(1).max(2000),
});

programasRouter.post('/coach/feedback', validate(createFeedbackSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const b = req.body as z.infer<typeof createFeedbackSchema>;
    const ok = await assertCoachOf(u, b.aluno_user_id);
    if (!ok) return res.status(403).json({ error: 'not coach of aluno' });
    const row = await withClient(async c => (await c.query(
      `INSERT INTO treinos.coach_feedback (coach_user_id, aluno_user_id, workout_session_id, texto)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [u, b.aluno_user_id, b.workout_session_id ?? null, b.texto]
    )).rows[0]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

programasRouter.get('/me/feedback', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const limit = Math.min(Number(req.query.limit || 30), 200);
    const rows = await withClient(async c => (await c.query(
      `SELECT cf.*, cu.name AS coach_nome
         FROM treinos.coach_feedback cf
         JOIN app.user cu ON cu.id = cf.coach_user_id
        WHERE cf.aluno_user_id=$1
        ORDER BY cf.created_at DESC LIMIT $2`,
      [u, limit]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

// =============================================================================
// TIMER PRESETS
// =============================================================================

const timerPresetSchema = z.object({
  nome: z.string().min(1).max(80),
  intervalo_seg: z.number().int().min(1).max(3600),
  beep_inicio: z.boolean().optional(),
  beep_fim: z.boolean().optional(),
});

programasRouter.get('/timer-presets', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const rows = await withClient(async c => (await c.query(
      `SELECT * FROM treinos.timer_preset WHERE user_id=$1 OR user_id IS NULL ORDER BY nome`,
      [u]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.post('/timer-presets', validate(timerPresetSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const b = req.body as z.infer<typeof timerPresetSchema>;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO treinos.timer_preset (user_id, nome, intervalo_seg, beep_inicio, beep_fim)
       VALUES ($1,$2,$3, COALESCE($4,true), COALESCE($5,true)) RETURNING *`,
      [u, b.nome, b.intervalo_seg, b.beep_inicio ?? null, b.beep_fim ?? null]
    )).rows[0]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

programasRouter.delete('/timer-presets/:id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const ok = await withClient(async c => {
      const r = await c.query(`DELETE FROM treinos.timer_preset WHERE id=$1 AND user_id=$2`, [id, u]);
      return (r.rowCount ?? 0) > 0;
    });
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// =============================================================================
// AUDIO CUE PROFILES
// =============================================================================

const audioProfileSchema = z.object({
  nome: z.string().min(1).max(80),
  provider: z.enum(['beep','spotify','apple_music','custom']).default('beep'),
  config: z.record(z.string(), z.any()).optional().nullable(),
  ativo: z.boolean().optional(),
});

programasRouter.get('/audio-cue-profiles', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const rows = await withClient(async c => (await c.query(
      `SELECT * FROM treinos.audio_cue_profile WHERE user_id=$1 OR user_id IS NULL ORDER BY nome`,
      [u]
    )).rows);
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.post('/audio-cue-profiles', validate(audioProfileSchema), async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const b = req.body as z.infer<typeof audioProfileSchema>;
    const row = await withClient(async c => (await c.query(
      `INSERT INTO treinos.audio_cue_profile (user_id, nome, provider, config, ativo)
       VALUES ($1,$2,$3,$4, COALESCE($5,true)) RETURNING *`,
      [u, b.nome, b.provider, b.config ? JSON.stringify(b.config) : null, b.ativo ?? null]
    )).rows[0]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

programasRouter.delete('/audio-cue-profiles/:id', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const ok = await withClient(async c => {
      const r = await c.query(`DELETE FROM treinos.audio_cue_profile WHERE id=$1 AND user_id=$2`, [id, u]);
      return (r.rowCount ?? 0) > 0;
    });
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});


// =============================================================================
// COACH — portal do personal (Sub-fase D)
// =============================================================================

const coachHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

programasRouter.get('/coach/alunos/:alunoId/dashboard', async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;
    const alunoUid = String(req.params.alunoId || '');
    const ok = await assertCoachOf(coachUid, alunoUid);
    if (!ok) return res.status(403).json({ error: 'not coach of aluno' });

    const data = await withClient(async c => {
      const aluno = (await c.query(
        `SELECT id, name, email, goal, birth_date, height_cm
           FROM app.user
          WHERE id=$1 AND active = TRUE`,
        [alunoUid]
      )).rows[0];
      if (!aluno) return null;

      const programa_atual = (await c.query(
        `WITH pa AS (
           SELECT pa.*, p.nome, p.nivel, p.objetivo, p.duracao_semanas,
                  LEAST(GREATEST(FLOOR((CURRENT_DATE - pa.started_on)::numeric / 7)::int + 1, 1), p.duracao_semanas) AS semana_atual
             FROM treinos.program_assignment pa
             JOIN treinos.program p ON p.id = pa.program_id
            WHERE pa.aluno_user_id=$1 AND pa.status='ativo'
            ORDER BY pa.started_on DESC, pa.id DESC
            LIMIT 1
         )
         SELECT pa.*,
                json_build_object('id', pa.program_id, 'nome', pa.nome, 'nivel', pa.nivel,
                                  'objetivo', pa.objetivo, 'duracao_semanas', pa.duracao_semanas) AS program,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', wt.id, 'semana_numero', wt.semana_numero, 'cor', wt.cor,
                    'nome_treino', wt.nome_treino, 'ordem', wt.ordem,
                    'exercicios_count', (SELECT COUNT(*)::int FROM treinos.exercise_prescription ep WHERE ep.workout_template_id = wt.id)
                  ) ORDER BY wt.ordem, wt.id)
                  FROM treinos.workout_template wt
                  WHERE wt.program_id = pa.program_id AND wt.semana_numero = pa.semana_atual
                ), '[]'::json) AS dias
           FROM pa`,
        [alunoUid]
      )).rows[0] ?? null;

      const metricas = (await c.query(
        `WITH sessoes AS (
           SELECT s.*, wt.cor, wt.nome_treino
             FROM treinos.workout_session s
             LEFT JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
            WHERE s.user_id=$1
         ), agg AS (
           SELECT COUNT(*)::int AS sessoes_total,
                  COUNT(*) FILTER (WHERE started_at >= now() - interval '7 days')::int AS sessoes_ultimos_7d,
                  COUNT(*) FILTER (WHERE started_at >= now() - interval '30 days')::int AS sessoes_ultimos_30d
             FROM sessoes
         ), last_s AS (
           SELECT id, started_at, finished_at, cor, nome_treino
             FROM sessoes
            ORDER BY started_at DESC, id DESC
            LIMIT 1
         ), volume AS (
           SELECT COALESCE(SUM(COALESCE(se.carga,0) * COALESCE(se.reps,0)),0)::numeric(12,2) AS volume_total_kg
             FROM treinos.workout_session s
             JOIN treinos.exercise_execution ee ON ee.workout_session_id = s.id
             JOIN treinos.set_execution se ON se.exercise_execution_id = ee.id
            WHERE s.user_id=$1 AND s.started_at >= now() - interval '30 days'
         )
         SELECT agg.sessoes_total, agg.sessoes_ultimos_7d, agg.sessoes_ultimos_30d,
                (SELECT row_to_json(last_s) FROM last_s) AS ultimo_treino,
                LEAST(100, ROUND((agg.sessoes_ultimos_30d::numeric / 21) * 100))::int AS pct_adesao_30d,
                volume.volume_total_kg
           FROM agg, volume`,
        [alunoUid]
      )).rows[0];

      const ultimas_sessoes = (await c.query(
        `SELECT s.id, s.started_at, s.finished_at, wt.cor, wt.nome_treino,
                COUNT(ee.id)::int AS exercicios_count
           FROM treinos.workout_session s
           LEFT JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
           LEFT JOIN treinos.exercise_execution ee ON ee.workout_session_id = s.id
          WHERE s.user_id=$1
          GROUP BY s.id, wt.cor, wt.nome_treino
          ORDER BY s.started_at DESC, s.id DESC
          LIMIT 10`,
        [alunoUid]
      )).rows;

      return { aluno, programa_atual, metricas, ultimas_sessoes };
    });

    if (!data) return res.status(404).json({ error: 'aluno not found' });
    res.json(data);
  } catch (e) { next(e); }
});

programasRouter.get('/coach/alunos/:alunoId/historico', validate(coachHistoryQuery, 'query'), async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;
    const alunoUid = String(req.params.alunoId || '');
    const ok = await assertCoachOf(coachUid, alunoUid);
    if (!ok) return res.status(403).json({ error: 'not coach of aluno' });
    const q = (req as any).validatedQuery as z.infer<typeof coachHistoryQuery>;

    const data = await withClient(async c => {
      const total = Number((await c.query(
        `SELECT COUNT(*)::int AS total FROM treinos.workout_session WHERE user_id=$1`,
        [alunoUid]
      )).rows[0]?.total ?? 0);

      const sessoes = (await c.query(
        `SELECT s.id, s.started_at, s.finished_at, s.data, s.status, wt.cor, wt.nome_treino,
                s.semana_numero, p.nome AS programa_nome,
                COALESCE(
                  s.duracao_min,
                  CASE WHEN s.finished_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (s.finished_at - s.started_at)) / 60)::int ELSE NULL END
                ) AS duracao_min,
                s.pse,
                CASE
                  WHEN s.pse IS NULL THEN NULL
                  WHEN s.pse <= 3 THEN 'leve'
                  WHEN s.pse <= 6 THEN 'moderado'
                  WHEN s.pse <= 8 THEN 'forte'
                  ELSE 'maximo'
                END AS intensidade
           FROM treinos.workout_session s
           LEFT JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
           LEFT JOIN treinos.program p ON p.id = s.program_id
          WHERE s.user_id=$1
          ORDER BY s.started_at DESC, s.id DESC
          LIMIT $2 OFFSET $3`,
        [alunoUid, q.limit, q.offset]
      )).rows;

      if (!sessoes.length) return { total, sessoes };
      const ids = sessoes.map(s => s.id);
      const exercicios = (await c.query(
        `SELECT ee.workout_session_id,
                ee.id,
                ec.nome_padrao AS exercise_nome,
                ec.grupo_muscular,
                COALESCE(json_agg(json_build_object(
                  'set_numero', se.set_numero, 'reps', se.reps, 'carga', se.carga, 'rpe', se.rpe
                ) ORDER BY se.set_numero) FILTER (WHERE se.id IS NOT NULL), '[]'::json) AS sets
           FROM treinos.exercise_execution ee
           JOIN treinos.exercise_catalog ec ON ec.id = ee.exercise_catalog_id
           LEFT JOIN treinos.set_execution se ON se.exercise_execution_id = ee.id
          WHERE ee.workout_session_id = ANY($1::int[])
          GROUP BY ee.workout_session_id, ee.id, ee.ordem, ec.nome_padrao, ec.grupo_muscular
          ORDER BY ee.workout_session_id, ee.ordem, ee.id`,
        [ids]
      )).rows;
      const bySession = new Map<number, any[]>();
      for (const ex of exercicios) {
        const arr = bySession.get(ex.workout_session_id) || [];
        arr.push({ id: ex.id, exercise_nome: ex.exercise_nome, grupo_muscular: ex.grupo_muscular, sets: ex.sets });
        bySession.set(ex.workout_session_id, arr);
      }
      return { total, sessoes: sessoes.map(s => ({ ...s, exercicios: bySession.get(s.id) || [] })) };
    });

    res.json(data);
  } catch (e) { next(e); }
});

programasRouter.get('/coach/me/dashboard', async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;

    const data = await withClient(async c => {
      const coach = (await c.query(
        `SELECT id, name, goal FROM app.user WHERE id=$1 AND active = TRUE`,
        [coachUid]
      )).rows[0];
      if (!coach) return null;

      const summary = (await c.query(
        `WITH alunos AS (
           SELECT ca.aluno_user_id
             FROM treinos.coach_assignment ca
            WHERE ca.coach_user_id=$1 AND ca.status='ativo'
         )
         SELECT (SELECT COUNT(*)::int FROM alunos) AS total_alunos,
                (SELECT COUNT(DISTINCT s.user_id)::int
                   FROM treinos.workout_session s
                   JOIN alunos a ON a.aluno_user_id = s.user_id
                  WHERE s.started_at >= now() - interval '7 days') AS alunos_ativos_7d`,
        [coachUid]
      )).rows[0];

      const alunos = (await c.query(
        `WITH base AS (
           SELECT au.id, au.name,
                  pa.program_id, pa.started_on, p.nome AS programa_atual_nome, p.duracao_semanas,
                  CASE WHEN pa.id IS NULL THEN NULL
                       ELSE LEAST(GREATEST(FLOOR((CURRENT_DATE - pa.started_on)::numeric / 7)::int + 1, 1), p.duracao_semanas)
                   END AS semana_atual
             FROM treinos.coach_assignment ca
             JOIN app.user au ON au.id = ca.aluno_user_id
             LEFT JOIN treinos.program_assignment pa ON pa.aluno_user_id = au.id AND pa.status='ativo'
             LEFT JOIN treinos.program p ON p.id = pa.program_id
            WHERE ca.coach_user_id=$1 AND ca.status='ativo'
         )
         SELECT b.id, b.name, b.programa_atual_nome,
                last_s.ultimo_treino_at,
                COALESCE(s7.sessoes_7d,0)::int AS sessoes_7d,
                LEAST(100, ROUND((COALESCE(s30.sessoes_30d,0)::numeric / 21) * 100))::int AS pct_adesao_30d
           FROM base b
           LEFT JOIN LATERAL (
             SELECT MAX(started_at) AS ultimo_treino_at FROM treinos.workout_session s WHERE s.user_id = b.id
           ) last_s ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS sessoes_7d FROM treinos.workout_session s WHERE s.user_id = b.id AND s.started_at >= now() - interval '7 days'
           ) s7 ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS sessoes_30d FROM treinos.workout_session s WHERE s.user_id = b.id AND s.started_at >= now() - interval '30 days'
           ) s30 ON TRUE
          ORDER BY b.name`,
        [coachUid]
      )).rows;

      const proximos_treinos = (await c.query(
        `WITH base AS (
           SELECT au.id AS aluno_id, au.name AS aluno_nome, pa.program_id,
                  LEAST(GREATEST(FLOOR((CURRENT_DATE - pa.started_on)::numeric / 7)::int + 1, 1), p.duracao_semanas) AS semana_atual
             FROM treinos.coach_assignment ca
             JOIN app.user au ON au.id = ca.aluno_user_id
             JOIN treinos.program_assignment pa ON pa.aluno_user_id = au.id AND pa.status='ativo'
             JOIN treinos.program p ON p.id = pa.program_id
            WHERE ca.coach_user_id=$1 AND ca.status='ativo'
         )
         SELECT b.aluno_id, b.aluno_nome,
                COALESCE(next_wt.id, first_wt.id) AS workout_template_id,
                COALESCE(next_wt.cor, first_wt.cor) AS cor,
                COALESCE(next_wt.nome_treino, first_wt.nome_treino) AS nome_treino,
                b.semana_atual
           FROM base b
           LEFT JOIN LATERAL (
             SELECT wt.ordem
               FROM treinos.workout_session s
               JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
              WHERE s.user_id = b.aluno_id AND s.program_id = b.program_id AND s.semana_numero = b.semana_atual
              ORDER BY s.started_at DESC, s.id DESC
              LIMIT 1
           ) last_wt ON TRUE
           LEFT JOIN LATERAL (
             SELECT id, cor, nome_treino
               FROM treinos.workout_template wt
              WHERE wt.program_id = b.program_id AND wt.semana_numero = b.semana_atual
                AND last_wt.ordem IS NOT NULL AND wt.ordem > last_wt.ordem
              ORDER BY wt.ordem, wt.id
              LIMIT 1
           ) next_wt ON TRUE
           LEFT JOIN LATERAL (
             SELECT id, cor, nome_treino
               FROM treinos.workout_template wt
              WHERE wt.program_id = b.program_id AND wt.semana_numero = b.semana_atual
              ORDER BY wt.ordem, wt.id
              LIMIT 1
           ) first_wt ON TRUE
          WHERE COALESCE(next_wt.id, first_wt.id) IS NOT NULL
          ORDER BY b.aluno_nome
          LIMIT 20`,
        [coachUid]
      )).rows;

      return { coach, total_alunos: summary.total_alunos, alunos_ativos_7d: summary.alunos_ativos_7d, proximos_treinos, alunos };
    });

    if (!data) return res.status(404).json({ error: 'coach not found' });
    res.json(data);
  } catch (e) { next(e); }
});

// =============================================================================
// PERSONAL DISCOVERY — experiência do aluno sem programa (Sub-fase F)
// =============================================================================

const personalMatchStrongTokens = new Set(['forca','hipertrofia','cross','funcional','corrida','resistencia','recomposicao','perda']);

function tokenizePersonalMatchText(value: unknown): Set<string> {
  return new Set(String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean));
}

function scorePersonalGoal(objetivo: string, goal: string | null): number {
  const objetivoTokens = tokenizePersonalMatchText(objetivo);
  const goalTokens = tokenizePersonalMatchText(goal);
  let score = 0;
  for (const token of objetivoTokens) {
    if (!goalTokens.has(token)) continue;
    score += 1;
    if (personalMatchStrongTokens.has(token)) score += 2;
  }
  return score;
}

const createMeCoachSchema = z.object({
  coach_user_id: uuid,
  observacoes: z.string().max(1000).optional().nullable(),
});

programasRouter.get('/personals', async (req, res, next) => {
  try {
    const objetivo = typeof req.query.objetivo === 'string' ? req.query.objetivo.trim() : '';
    const rows = await withClient(async c => (await c.query(
      `SELECT u.id, u.name, u.goal, u.avatar_url, u.height_cm,
              COALESCE(a.alunos_ativos, 0)::int AS alunos_ativos,
              COALESCE(s.sessoes_alunos_7d, 0)::int AS sessoes_alunos_7d
         FROM app.user u
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS alunos_ativos
             FROM treinos.coach_assignment ca
            WHERE ca.coach_user_id = u.id AND ca.status = 'ativo'
         ) a ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS sessoes_alunos_7d
             FROM treinos.coach_assignment ca
             JOIN treinos.workout_session ws ON ws.user_id = ca.aluno_user_id
            WHERE ca.coach_user_id = u.id
              AND ca.status = 'ativo'
              AND ws.started_at >= now() - interval '7 days'
         ) s ON TRUE
        WHERE u.active = TRUE AND u.role = 'personal'`
    )).rows);

    const data = rows.map(row => {
      const base = {
        id: row.id,
        name: row.name,
        goal: row.goal,
        avatar_url: row.avatar_url,
        height_cm: row.height_cm,
        alunos_ativos: row.alunos_ativos,
        sessoes_alunos_7d: row.sessoes_alunos_7d,
      };
      return objetivo ? { ...base, score: scorePersonalGoal(objetivo, row.goal) } : base;
    });

    data.sort((a: any, b: any) => {
      if (objetivo && b.score !== a.score) return b.score - a.score;
      if (a.alunos_ativos !== b.alunos_ativos) return a.alunos_ativos - b.alunos_ativos;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });

    res.json(data);
  } catch (e) { next(e); }
});

programasRouter.post('/me/coach', validate(createMeCoachSchema), async (req, res, next) => {
  try {
    const alunoUid = requireUid(req, res); if (!alunoUid) return;
    const { coach_user_id, observacoes } = req.body as z.infer<typeof createMeCoachSchema>;
    if (coach_user_id === alunoUid) return res.status(400).json({ error: 'coach cannot be aluno' });

    const data = await withClient(async c => {
      const personal = (await c.query(
        `SELECT id, name, goal, avatar_url
           FROM app.user
          WHERE id=$1 AND role='personal' AND active = TRUE`,
        [coach_user_id]
      )).rows[0];
      if (!personal) return { kind: 'not_found' as const };

      const current = (await c.query(
        `SELECT id FROM treinos.coach_assignment
          WHERE aluno_user_id=$1 AND status='ativo'
          LIMIT 1`,
        [alunoUid]
      )).rows[0];
      if (current) return { kind: 'conflict' as const };

      const assignment = (await c.query(
        `INSERT INTO treinos.coach_assignment (coach_user_id, aluno_user_id, status, observacoes)
         VALUES ($1,$2,'ativo',$3)
         RETURNING id, coach_user_id, aluno_user_id, status, started_on, ended_on, observacoes, created_at, updated_at`,
        [coach_user_id, alunoUid, observacoes ?? null]
      )).rows[0];

      return { kind: 'created' as const, assignment, coach: personal };
    });

    if (data.kind === 'not_found') return res.status(404).json({ error: 'personal not found' });
    if (data.kind === 'conflict') return res.status(409).json({ error: 'aluno already has active coach' });
    res.status(201).json({ assignment: data.assignment, coach: data.coach });
  } catch (e) { next(e); }
});

programasRouter.get('/me/coach', async (req, res, next) => {
  try {
    const alunoUid = requireUid(req, res); if (!alunoUid) return;
    const row = await withClient(async c => (await c.query(
      `SELECT ca.id, ca.status, ca.started_on, ca.observacoes,
              u.id AS coach_id, u.name AS coach_name, u.goal AS coach_goal, u.avatar_url AS coach_avatar_url
         FROM treinos.coach_assignment ca
         JOIN app.user u ON u.id = ca.coach_user_id
        WHERE ca.aluno_user_id=$1 AND ca.status='ativo'
        ORDER BY ca.started_on DESC, ca.id DESC
        LIMIT 1`,
      [alunoUid]
    )).rows[0]);

    if (!row) return res.json({ coach: null, assignment: null });
    res.json({
      coach: { id: row.coach_id, name: row.coach_name, goal: row.coach_goal, avatar_url: row.coach_avatar_url },
      assignment: { id: row.id, status: row.status, started_on: row.started_on, observacoes: row.observacoes },
    });
  } catch (e) { next(e); }
});

programasRouter.delete('/me/coach', async (req, res, next) => {
  try {
    const alunoUid = requireUid(req, res); if (!alunoUid) return;
    await withClient(async c => { await c.query(
      `UPDATE treinos.coach_assignment
          SET status='encerrado', ended_on=CURRENT_DATE, updated_at=now()
        WHERE aluno_user_id=$1 AND status='ativo'`,
      [alunoUid]
    ); });
    res.status(204).end();
  } catch (e) { next(e); }
});

// === SUB-FASE H ===

const subFaseHNiveis = ['iniciante', 'intermediario', 'avancado'] as const;
const createCoachProgramSchema = z.object({
  nivel: z.enum(subFaseHNiveis),
  nome: z.string().max(120).optional().nullable(),
  objetivo: z.string().max(2000).optional().nullable(),
  duracao_semanas: z.number().int().min(1).max(52),
});

const assignCoachProgramSchema = z.object({
  programa_id: positiveInt,
});

const subFaseHCategoria: Record<typeof subFaseHNiveis[number], string> = {
  iniciante: 'Iniciante',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
};

function toRoman(n: number): string {
  const parts: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let rest = n;
  let out = '';
  for (const [value, symbol] of parts) {
    while (rest >= value) { out += symbol; rest -= value; }
  }
  return out;
}

async function assertPersonalUser(c: PoolClient, userId: string): Promise<boolean> {
  const row = (await c.query(
    `SELECT 1 FROM app.user WHERE id=$1 AND role='personal' AND active = TRUE LIMIT 1`,
    [userId]
  )).rows[0];
  return !!row;
}

async function nextCoachProgramName(c: PoolClient, nivel: typeof subFaseHNiveis[number]): Promise<string> {
  const categoria = subFaseHCategoria[nivel];
  const count = Number((await c.query(
    `SELECT COUNT(*)::int AS total FROM treinos.program WHERE nivel=$1`,
    [nivel]
  )).rows[0]?.total || 0);

  let next = count + 1;
  while (true) {
    const candidate = `Programa ${categoria} ${toRoman(next)}`;
    const exists = (await c.query(`SELECT 1 FROM treinos.program WHERE nome=$1 LIMIT 1`, [candidate])).rows[0];
    if (!exists) return candidate;
    next += 1;
  }
}

programasRouter.get('/coach/programas', async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;
    const nivel = typeof req.query.nivel === 'string' ? req.query.nivel : undefined;
    if (nivel && !subFaseHNiveis.includes(nivel as any)) return res.status(400).json({ error: 'invalid nivel' });

    const rows = await withClient(async c => {
      const isPersonal = await assertPersonalUser(c, coachUid);
      if (!isPersonal) return null;
      const args: any[] = [];
      const where = ['ativo = TRUE'];
      if (nivel) { args.push(nivel); where.push(`nivel = $${args.length}`); }
      return (await c.query(
        `SELECT id, nome, nivel, objetivo, duracao_semanas, ativo, autor_user_id, created_at, updated_at,
                (SELECT COUNT(*)::int FROM treinos.workout_template wt WHERE wt.program_id = p.id) AS templates_count
           FROM treinos.program p
          WHERE ${where.join(' AND ')}
          ORDER BY (nivel='iniciante') DESC, (nivel='intermediario') DESC, nome`,
        args
      )).rows;
    });

    if (!rows) return res.status(403).json({ error: 'personal role required' });
    res.json(rows);
  } catch (e) { next(e); }
});

programasRouter.post('/coach/programas', validate(createCoachProgramSchema), async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;
    const b = req.body as z.infer<typeof createCoachProgramSchema>;

    const data = await withClient(async c => {
      const isPersonal = await assertPersonalUser(c, coachUid);
      if (!isPersonal) return { kind: 'forbidden' as const };

      const nome = (b.nome || '').trim() || await nextCoachProgramName(c, b.nivel);
      const programa = (await c.query(
        `INSERT INTO treinos.program (nome, nivel, objetivo, duracao_semanas, autor_user_id, ativo)
         VALUES ($1,$2,$3,$4,$5,TRUE)
         RETURNING id, nome, nivel, objetivo, duracao_semanas, ativo, autor_user_id, created_at, updated_at`,
        [nome, b.nivel, (b.objetivo || '').trim() || null, b.duracao_semanas, coachUid]
      )).rows[0];
      return { kind: 'created' as const, programa };
    });

    if (data.kind === 'forbidden') return res.status(403).json({ error: 'personal role required' });
    res.status(201).json(data.programa);
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'programa nome already exists' });
    next(e);
  }
});

programasRouter.post('/coach/alunos/:alunoId/assign-program', validate(assignCoachProgramSchema), async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;
    const alunoUid = String(req.params.alunoId || '');
    const { programa_id } = req.body as z.infer<typeof assignCoachProgramSchema>;

    const data = await withClient(async c => {
      const isPersonal = await assertPersonalUser(c, coachUid);
      if (!isPersonal) return { kind: 'forbidden' as const };

      const rel = (await c.query(
        `SELECT 1 FROM treinos.coach_assignment
          WHERE coach_user_id=$1 AND aluno_user_id=$2 AND status='ativo'
          LIMIT 1`,
        [coachUid, alunoUid]
      )).rows[0];
      if (!rel) return { kind: 'not_coach' as const };

      const program = (await c.query(
        `SELECT id, nome, nivel, objetivo, duracao_semanas
           FROM treinos.program
          WHERE id=$1 AND ativo = TRUE`,
        [programa_id]
      )).rows[0];
      if (!program) return { kind: 'program_not_found' as const };

      await c.query('BEGIN');
      try {
        await c.query(
          `UPDATE treinos.program_assignment
              SET status='encerrado', ended_on=CURRENT_DATE, updated_at=now()
            WHERE aluno_user_id=$1 AND status='ativo'`,
          [alunoUid]
        );
        const assignment = (await c.query(
          `INSERT INTO treinos.program_assignment (aluno_user_id, program_id, coach_user_id, status, source)
           VALUES ($1,$2,$3,'ativo','coach')
           RETURNING *`,
          [alunoUid, programa_id, coachUid]
        )).rows[0];
        await c.query('COMMIT');
        return { kind: 'created' as const, assignment, program };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });

    if (data.kind === 'forbidden') return res.status(403).json({ error: 'personal role required' });
    if (data.kind === 'not_coach') return res.status(403).json({ error: 'not coach of aluno' });
    if (data.kind === 'program_not_found') return res.status(404).json({ error: 'program not found or inactive' });
    res.status(201).json({ assignment: data.assignment, program: data.program });
  } catch (e) { next(e); }
});

// === FASE 5 L ===
programasRouter.get('/coach/me/metrics', async (req, res, next) => {
  try {
    const coachUid = requireUid(req, res); if (!coachUid) return;

    const data = await withClient(async c => {
      const isPersonal = await assertPersonalUser(c, coachUid);
      if (!isPersonal) return null;

      const summary = (await c.query(
        `WITH alunos AS (
           SELECT ca.aluno_user_id, au.name, ca.started_on
             FROM treinos.coach_assignment ca
             JOIN app.user au ON au.id = ca.aluno_user_id AND au.active = TRUE
            WHERE ca.coach_user_id=$1 AND ca.status='ativo'
         ), logs30 AS (
           SELECT wl.user_id, wl.duration_min
             FROM treinos.workout_log wl
             JOIN alunos a ON a.aluno_user_id = wl.user_id
            WHERE wl.trained_on >= CURRENT_DATE - INTERVAL '29 days'
         )
         SELECT (SELECT COUNT(*)::int FROM alunos) AS alunos_ativos,
                (SELECT COUNT(*)::int FROM logs30) AS sessoes_realizadas_30d,
                (SELECT ROUND(AVG(duration_min))::int FROM logs30 WHERE duration_min IS NOT NULL) AS duracao_media_30d`,
        [coachUid]
      )).rows[0];

      const alunosInativos = (await c.query(
        `WITH alunos AS (
           SELECT ca.aluno_user_id AS id, au.name, ca.started_on
             FROM treinos.coach_assignment ca
             JOIN app.user au ON au.id = ca.aluno_user_id AND au.active = TRUE
            WHERE ca.coach_user_id=$1 AND ca.status='ativo'
         ), ultimo AS (
           SELECT a.id, a.name, a.started_on, MAX(wl.trained_on) AS ultimo_treino
             FROM alunos a
             LEFT JOIN treinos.workout_log wl ON wl.user_id = a.id
            GROUP BY a.id, a.name, a.started_on
         )
         SELECT id, name,
                GREATEST(0, (CURRENT_DATE - COALESCE(ultimo_treino, started_on))::int) AS dias_inativo
           FROM ultimo
          WHERE ultimo_treino IS NULL OR ultimo_treino < CURRENT_DATE - INTERVAL '7 days'
          ORDER BY dias_inativo DESC, name`,
        [coachUid]
      )).rows;

      const alunosAtivos = Number(summary?.alunos_ativos || 0);
      const realizadas = Number(summary?.sessoes_realizadas_30d || 0);
      // Heurística da Fase 5: treino esperado = 4 sessões/semana por aluno ativo por 4 semanas.
      // Usamos treinos.workout_log como registro simplificado de treino realizado no período de 30 dias.
      const esperadas = alunosAtivos * 4 * 4;
      const aderencia = esperadas > 0 ? Math.min(100, Math.round((realizadas / esperadas) * 100)) : 0;

      return {
        aderencia_30d: aderencia,
        duracao_media_30d: Number(summary?.duracao_media_30d || 0),
        alunos_inativos_7d: alunosInativos.map(a => ({ id: a.id, name: a.name, dias_inativo: Number(a.dias_inativo || 0) })),
      };
    });

    if (!data) return res.status(403).json({ error: 'personal role required' });
    res.json(data);
  } catch (e) { next(e); }
});
