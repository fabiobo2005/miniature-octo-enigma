import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { basename, resolve } from 'path';
import type { PoolClient } from 'pg';
import { withClient, endPool } from './db';

type Nivel = 'iniciante' | 'intermediario' | 'avancado';
type TipoPrograma = 'musculacao' | 'cross' | 'corrida';
type TipoExercicio = 'forca' | 'cardio' | 'mobilidade' | 'core';

type SeedExercise = {
  ordem: number;
  nome: string;
  grupo_muscular?: string | null;
  equipamento?: string | null;
  tipo: TipoExercicio;
  series?: number | null;
  reps?: string | null;
  cadencia?: string | null;
  intervalo_seg?: number | null;
  metodo?: string | null;
  observacoes?: string | null;
  carga_sugerida?: string | null;
};

type SeedWorkout = {
  cor: string;
  nome_treino: string;
  ordem: number;
  observacoes?: string | null;
  exercicios: SeedExercise[];
};

type SeedWeek = {
  semana_numero: number;
  microciclo_numero?: number | null;
  observacoes?: string | null;
  treinos: SeedWorkout[];
};

type SeedProgram = {
  categoria: Nivel;
  duracao_semanas: number;
  objetivo: string;
  tipo: TipoPrograma;
  observacoes?: string | null;
  semanas: SeedWeek[];
};

type SeedFile = { programas: SeedProgram[] };

const NIVEL_LABEL: Record<Nivel, string> = {
  iniciante: 'Iniciante',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
};
const NIVEL_VALUES = new Set<Nivel>(['iniciante', 'intermediario', 'avancado']);
const TIPO_PROGRAMA_VALUES = new Set<TipoPrograma>(['musculacao', 'cross', 'corrida']);
const TIPO_EXERCICIO_VALUES = new Set<TipoExercicio>(['forca', 'cardio', 'mobilidade', 'core']);
const CORES = ['azul', 'verde', 'laranja', 'vermelho', 'amarelo'];
const SOURCE_FILE = 'seed-programas.json';

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`romano inválido: ${n}`);
  let out = '';
  let value = n;
  for (const [amount, symbol] of ROMAN_TABLE) {
    while (value >= amount) {
      out += symbol;
      value -= amount;
    }
  }
  return out;
}

function romanToInt(value: string): number | null {
  let i = 0;
  let total = 0;
  const upper = value.toUpperCase();
  for (const [amount, symbol] of ROMAN_TABLE) {
    while (upper.slice(i, i + symbol.length) === symbol) {
      total += amount;
      i += symbol.length;
    }
  }
  return i === upper.length ? total : null;
}

function programNameFor(nivel: Nivel, roman: string): string {
  return `Programa ${NIVEL_LABEL[nivel]} ${roman}`;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function parseArgs(argv: string[]) {
  return { force: argv.includes('--force') };
}

function validateSeed(data: SeedFile): void {
  if (!Array.isArray(data.programas) || data.programas.length !== 9) {
    throw new Error('seed-programas.json deve conter exatamente 9 programas.');
  }

  data.programas.forEach((programa, idx) => {
    if (!NIVEL_VALUES.has(programa.categoria)) throw new Error(`Programa ${idx + 1}: categoria inválida.`);
    if (!TIPO_PROGRAMA_VALUES.has(programa.tipo)) throw new Error(`Programa ${idx + 1}: tipo inválido.`);
    if (!Number.isInteger(programa.duracao_semanas) || programa.duracao_semanas < 1 || programa.duracao_semanas > 52) {
      throw new Error(`Programa ${idx + 1}: duracao_semanas inválida.`);
    }
    if (!Array.isArray(programa.semanas) || programa.semanas.length !== programa.duracao_semanas) {
      throw new Error(`Programa ${idx + 1}: semanas não conferem com duração.`);
    }

    for (const semana of programa.semanas) {
      if (!Number.isInteger(semana.semana_numero) || semana.semana_numero < 1 || semana.semana_numero > 52) {
        throw new Error(`Programa ${idx + 1}: semana inválida.`);
      }
      if (!Array.isArray(semana.treinos) || semana.treinos.length !== 5) {
        throw new Error(`Programa ${idx + 1}, semana ${semana.semana_numero}: deve haver exatamente 5 treinos.`);
      }
      const cores = semana.treinos.map((t) => t.cor);
      if (new Set(cores).size !== 5 || !CORES.every((cor) => cores.includes(cor))) {
        throw new Error(`Programa ${idx + 1}, semana ${semana.semana_numero}: cores devem ser ${CORES.join(', ')}.`);
      }
      for (const treino of semana.treinos) {
        const minExercises = programa.tipo === 'corrida' ? 1 : 4;
        if (!Array.isArray(treino.exercicios) || treino.exercicios.length < minExercises) {
          throw new Error(`Programa ${idx + 1}, semana ${semana.semana_numero}, ${treino.nome_treino}: exercícios insuficientes.`);
        }
        for (const exercise of treino.exercicios) {
          if (!exercise.nome?.trim()) throw new Error(`Exercício sem nome em ${treino.nome_treino}.`);
          if (!TIPO_EXERCICIO_VALUES.has(exercise.tipo)) throw new Error(`Exercício ${exercise.nome}: tipo inválido.`);
        }
      }
    }
  });
}

function programSha(programa: SeedProgram): string {
  return sha256(JSON.stringify(programa));
}

async function usedRomansByNivel(c: PoolClient): Promise<Record<Nivel, Set<number>>> {
  const used: Record<Nivel, Set<number>> = {
    iniciante: new Set(), intermediario: new Set(), avancado: new Set(),
  };
  const rows = await c.query(`SELECT nome, nivel FROM treinos.program`);
  for (const row of rows.rows) {
    const nivel = row.nivel as Nivel;
    if (!NIVEL_VALUES.has(nivel)) continue;
    const match = String(row.nome).match(/^Programa\s+(?:Iniciante|Intermedi[áa]rio|Avan[çc]ado)\s+([IVXLC]+)$/);
    if (!match) continue;
    const roman = romanToInt(match[1]);
    if (roman) used[nivel].add(roman);
  }
  return used;
}

async function assignNames(c: PoolClient, programas: SeedProgram[]): Promise<Map<number, { nome: string; sha: string; existingId?: number }>> {
  const shas = programas.map(programSha);
  const existingBySha = new Map<string, { id: number; nome: string; nivel: Nivel }>();
  const existing = await c.query(
    `SELECT id, nome, nivel, source_sha256 FROM treinos.program WHERE source_sha256 = ANY($1::text[])`,
    [shas]
  );
  for (const row of existing.rows) {
    existingBySha.set(row.source_sha256, { id: row.id, nome: row.nome, nivel: row.nivel });
  }

  const used = await usedRomansByNivel(c);
  const assigned = new Map<number, { nome: string; sha: string; existingId?: number }>();
  for (let i = 0; i < programas.length; i += 1) {
    const programa = programas[i];
    const sha = shas[i];
    const found = existingBySha.get(sha);
    if (found && found.nivel === programa.categoria) {
      assigned.set(i, { nome: found.nome, sha, existingId: found.id });
      const match = found.nome.match(/\s([IVXLC]+)$/);
      const roman = match ? romanToInt(match[1]) : null;
      if (roman) used[programa.categoria].add(roman);
      continue;
    }

    let next = 1;
    while (used[programa.categoria].has(next)) next += 1;
    used[programa.categoria].add(next);
    assigned.set(i, { nome: programNameFor(programa.categoria, toRoman(next)), sha, existingId: found?.id });
  }
  return assigned;
}

async function upsertExercise(c: PoolClient, exercise: SeedExercise): Promise<number> {
  const result = await c.query(
    `INSERT INTO treinos.exercise_catalog (nome_padrao, grupo_muscular, equipamento, tipo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (nome_padrao) DO UPDATE
       SET grupo_muscular = COALESCE(treinos.exercise_catalog.grupo_muscular, EXCLUDED.grupo_muscular),
           equipamento = COALESCE(treinos.exercise_catalog.equipamento, EXCLUDED.equipamento),
           tipo = EXCLUDED.tipo,
           updated_at = now()
     RETURNING id`,
    [exercise.nome.trim(), exercise.grupo_muscular ?? null, exercise.equipamento ?? null, exercise.tipo]
  );
  const id = result.rows[0].id as number;
  await c.query(
    `INSERT INTO treinos.exercise_alias (exercise_catalog_id, alias, origem)
     VALUES ($1, $2, 'seed-json')
     ON CONFLICT (alias_norm) DO NOTHING`,
    [id, exercise.nome.trim()]
  );
  return id;
}

async function insertProgram(c: PoolClient, programa: SeedProgram, nome: string, sourceSha: string): Promise<{ id: number; templates: number; prescriptions: number }> {
  const programId = (await c.query(
    `INSERT INTO treinos.program (nome, objetivo, duracao_semanas, nivel, source_file, source_sha256, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     RETURNING id`,
    [nome, programa.objetivo, programa.duracao_semanas, programa.categoria, SOURCE_FILE, sourceSha]
  )).rows[0].id as number;

  let templates = 0;
  let prescriptions = 0;
  for (const semana of programa.semanas) {
    await c.query(
      `INSERT INTO treinos.program_week (program_id, semana_numero, microciclo_numero, observacoes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (program_id, semana_numero) DO UPDATE
         SET microciclo_numero = EXCLUDED.microciclo_numero,
             observacoes = EXCLUDED.observacoes`,
      [programId, semana.semana_numero, semana.microciclo_numero ?? null, semana.observacoes ?? null]
    );

    for (const treino of semana.treinos) {
      const templateId = (await c.query(
        `INSERT INTO treinos.workout_template (program_id, semana_numero, cor, nome_treino, ordem, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [programId, semana.semana_numero, treino.cor, treino.nome_treino, treino.ordem, treino.observacoes ?? null]
      )).rows[0].id as number;
      templates += 1;

      for (const exercise of treino.exercicios) {
        const exerciseId = await upsertExercise(c, exercise);
        await c.query(
          `INSERT INTO treinos.exercise_prescription
             (workout_template_id, exercise_catalog_id, ordem, series, reps, cadencia,
              intervalo_seg, metodo, observacoes, carga_sugerida, nome_original, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            templateId, exerciseId, exercise.ordem, exercise.series ?? null, exercise.reps ?? null,
            exercise.cadencia ?? null, exercise.intervalo_seg ?? null, exercise.metodo ?? null,
            exercise.observacoes ?? null, exercise.carga_sugerida ?? null, exercise.nome,
            JSON.stringify(exercise),
          ]
        );
        prescriptions += 1;
      }
    }
  }
  return { id: programId, templates, prescriptions };
}

async function importRunColumns(c: PoolClient): Promise<Set<string>> {
  const result = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'treinos' AND table_name = 'import_run'`
  );
  return new Set(result.rows.map((row) => row.column_name as string));
}

async function createImportRun(c: PoolClient, columns: Set<string>, rowsRead: number, rowsImported: number, log: unknown, fileSha: string): Promise<void> {
  const names: string[] = [];
  const values: unknown[] = [];
  const add = (name: string, value: unknown) => {
    if (!columns.has(name)) return;
    names.push(name);
    values.push(value);
  };

  add('file_name', SOURCE_FILE);
  add('source_file', SOURCE_FILE);
  add('source_sha256', sha256(`${fileSha}:seed-json:${Date.now()}`));
  add('tipo', 'seed-json');
  add('rows_read', rowsRead);
  add('rows_imported', rowsImported);
  add('status', 'success');
  add('finished_at', new Date());
  add('log', JSON.stringify(log));

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  await c.query(`INSERT INTO treinos.import_run (${names.join(', ')}) VALUES (${placeholders})`, values);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const seedPath = resolve(__dirname, SOURCE_FILE);
  const raw = readFileSync(seedPath, 'utf8');
  const data = JSON.parse(raw) as SeedFile;
  validateSeed(data);

  const rowsRead = data.programas.reduce(
    (sum, programa) => sum + programa.semanas.reduce(
      (weekSum, semana) => weekSum + semana.treinos.reduce((trainSum, treino) => trainSum + treino.exercicios.length, 0),
      0
    ),
    0
  );

  const summary = await withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const assigned = await assignNames(c, data.programas);
      const results: Array<{ nome: string; status: 'inserted' | 'skipped' | 'reinserted'; templates: number; prescriptions: number }> = [];
      let rowsImported = 0;

      for (let i = 0; i < data.programas.length; i += 1) {
        const programa = data.programas[i];
        const decision = assigned.get(i);
        if (!decision) throw new Error(`Falha ao atribuir nome ao programa ${i + 1}.`);

        const duplicate = await c.query(`SELECT id FROM treinos.program WHERE nome = $1 LIMIT 1`, [decision.nome]);
        const duplicateId = duplicate.rows[0]?.id as number | undefined;
        if (duplicateId && !args.force) {
          console.log(`[skip] ${decision.nome} já existe. Use --force para reimportar.`);
          results.push({ nome: decision.nome, status: 'skipped', templates: 0, prescriptions: 0 });
          continue;
        }
        if (duplicateId && args.force) {
          await c.query(`DELETE FROM treinos.program WHERE id = $1`, [duplicateId]);
        } else if (decision.existingId && args.force) {
          await c.query(`DELETE FROM treinos.program WHERE id = $1`, [decision.existingId]);
        }

        const inserted = await insertProgram(c, programa, decision.nome, decision.sha);
        rowsImported += inserted.prescriptions;
        results.push({ nome: decision.nome, status: duplicateId && args.force ? 'reinserted' : 'inserted', templates: inserted.templates, prescriptions: inserted.prescriptions });
        console.log(`[ok] ${decision.nome}: ${inserted.templates} templates, ${inserted.prescriptions} prescrições.`);
      }

      await createImportRun(c, await importRunColumns(c), rowsRead, rowsImported, { tipo: 'seed-json', results }, sha256(raw));
      await c.query('COMMIT');
      return { results, rowsRead, rowsImported };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  });

  console.log(`\nSeed ${basename(seedPath)} concluído: ${summary.rowsImported}/${summary.rowsRead} prescrições importadas.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await endPool();
});
