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
                ec.id AS exercise_id, ec.nome AS exercise_nome, ec.grupo_muscular,
                ec.equipamento, ec.lateralidade,
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
                ee.exercise_catalog_id, ec.nome AS exercise_nome, ec.grupo_muscular,
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

// Próximo treino sugerido: pega o template da última sessão concluída
// (mesma cor, mesmo programa, próxima ordem) ou o primeiro do programa atual.
programasRouter.get('/me/proximo-treino', async (req, res, next) => {
  try {
    const u = requireUid(req, res); if (!u) return;
    const data = await withClient(async c => {
      const last = (await c.query(
        `SELECT s.program_id, s.workout_template_id, s.semana_numero, wt.ordem, wt.cor
           FROM treinos.workout_session s
           JOIN treinos.workout_template wt ON wt.id = s.workout_template_id
          WHERE s.user_id=$1 AND s.status='finished'
          ORDER BY s.data DESC, s.id DESC LIMIT 1`,
        [u]
      )).rows[0];
      if (!last) return null;
      // próxima por ordem dentro do mesmo programa+semana, depois rotaciona
      const next = (await c.query(
        `SELECT * FROM treinos.workout_template
          WHERE program_id=$1 AND semana_numero=$2 AND ordem > $3
          ORDER BY ordem, id LIMIT 1`,
        [last.program_id, last.semana_numero, last.ordem]
      )).rows[0]
      || (await c.query(
        `SELECT * FROM treinos.workout_template
          WHERE program_id=$1 AND semana_numero=$2
          ORDER BY ordem, id LIMIT 1`,
        [last.program_id, last.semana_numero]
      )).rows[0];
      return next ?? null;
    });
    if (!data) return res.json(null);
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
