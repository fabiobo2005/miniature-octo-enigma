// Importer idempotente das planilhas de Programas de Treino.
//
// Uso:
//   npm run import:treinos -- --dir <diretorio>
//   npm run import:treinos -- --file <arquivo.xlsx>
//   npm run import:treinos -- --dry-run            (parseia e mostra estatísticas; não grava)
//   npm run import:treinos -- --force              (reimporta mesmo se sha256 já success)
//   npm run import:treinos -- --no-seed            (não carrega aliases.json no início)
//   npm run import:treinos -- --nivel <iniciante|intermediario|avancado>
//                                                   (sobrescreve a classificação para TODOS
//                                                    os arquivos do run; útil com --file)
//
// Classificação de programas
//   A classificação (nivel) é OBRIGATÓRIA. O importer aplica uma heurística baseada em:
//     - Métodos avançados detectados (drop-set, ondulatório, excêntrico, bi-set, tri-set,
//       ponto zero, série de saída, reconhecimento, exaustão, TUT alto, repetições forçadas)
//     - Exercícios complexos (Levantamento Terra, Agachamento Hack/Pêndulo, Flexão Nórdica,
//       Barra Fixa, Agachamento Livre, Stiff)
//   Limiar: score >= 8 → avancado, >= 4 → intermediario, senão iniciante.
//   --nivel sobrepõe a heurística.
//
// Nomes (padrão obrigatório):
//   "Programa Iniciante I", "Programa Intermediário II", "Programa Avançado III", ...
//   Numerais romanos atribuídos por categoria, considerando programas já existentes no DB
//   (idempotência preservada via lookup por source_sha256).
//
// Padrão de planilha (validado nos 6 arquivos do projeto):
//   - Cada SHEET corresponde a uma cor (Amarelo, Verde, Vermelho, Azul, Laranja, ...).
//   - Sheets "Sistemas e Métodos" são ignoradas; "Aeróbio"/"Cardiorrespiratório"
//     são tratadas como cardio (parsing leve, sem prescrição por série).
//   - Dentro do sheet, blocos de semana se repetem. Título de bloco:
//        "1ª Semana", "2ª Semana - Força", "1ª Semana - TODAS COM SÉRIES DE SAÍDA",
//        "Alternado por grupo muscular - Treino A" (variantes sem numeração).
//     Quando NÃO há "Nª Semana" no título, usamos a ordem de aparição como número da semana.
//   - Cabeçalho da tabela: linha começando com "Exercícios".
//   - Linhas de exercício: nome | series | reps | cadencia | intervalo | metodo | obs | carga | load
//   - Linha de métricas de sessão: começa com "Percepção Subjetiva de Esforço".

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';
import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { withClient, endPool } from './db';

// ---------- Args ----------
type Args = {
  dir?: string;
  file?: string;
  dryRun: boolean;
  force: boolean;
  seed: boolean;
  nivelOverride?: Nivel;
};

type Nivel = 'iniciante' | 'intermediario' | 'avancado';
const NIVEL_LABEL: Record<Nivel, string> = {
  iniciante: 'Iniciante',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
};
const NIVEL_VALUES: ReadonlySet<Nivel> = new Set(['iniciante','intermediario','avancado'] as const);

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, force: false, seed: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') a.dir = argv[++i];
    else if (arg === '--file') a.file = argv[++i];
    else if (arg === '--dry-run' || arg === '-n') a.dryRun = true;
    else if (arg === '--force' || arg === '-f') a.force = true;
    else if (arg === '--no-seed') a.seed = false;
    else if (arg === '--nivel') {
      const v = String(argv[++i] || '').toLowerCase() as Nivel;
      if (!NIVEL_VALUES.has(v)) {
        console.error(`--nivel inválido: "${v}". Use: iniciante | intermediario | avancado`);
        process.exit(2);
      }
      a.nivelOverride = v;
    }
    else if (arg === '--help' || arg === '-h') {
      console.log('Uso: npm run import:treinos -- [--dir <dir>] [--file <xlsx>] [--dry-run] [--force] [--no-seed] [--nivel iniciante|intermediario|avancado]');
      process.exit(0);
    }
  }
  return a;
}

// ---------- Utils ----------
const COLOR_SHEETS = new Set([
  'amarelo','verde','vermelho','azul','laranja','roxo','rosa','preto','branco','cinza','marrom'
]);
const CARDIO_SHEETS = new Set(['aerobio','aeróbio','cardio','cardiorrespiratorio','cardiorrespiratório']);

const RX_SEMANA = /(\d+)\s*[ªa°º]?\s*\bSemana\b/i;
const RX_TITULO_TREINO = /^\s*(treino\s+[A-Za-z0-9]+|alternado|push|pull|legs?|full\s*body|sup(erior)?|inf(erior)?)/i;
const RX_HEADER_EX = /^\s*Exerc[ií]cios?\s*$/i;
const RX_PSE = /^\s*Percep[cç][aã]o\s+Subjetiva/i;

function norm(s: any): string {
  return (s == null ? '' : String(s)).normalize('NFC').replace(/\s+/g, ' ').trim();
}
function normKey(s: any): string {
  return norm(s).toLowerCase();
}

function sha256OfFile(p: string): string {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

// ---------- Classificação ----------
const ADV_METHOD_PATTERNS: RegExp[] = [
  /\bdrop[\s-]?set\b/i,
  /\bondulat[óo]ri/i,
  /\bexc[êe]ntric/i,
  /\bbi[\s-]?set\b/i,
  /\btri[\s-]?set\b/i,
  /\bponto\s*zero\b/i,
  /\bs[ée]rie\s+de\s+sa[íi]da\b/i,
  /\breconhecimento\b/i,
  /\bexaust[ãa]o\b/i,
  /\btut\s*[>≥]/i,
  /\brepeti[cç][oõ]es?\s+for[cç]adas\b/i,
  /\brest[\s-]?pause\b/i,
  /\bpico\s+de\s+contra[cç][ãa]o\b/i,
];
const ADV_EXERCISE_PATTERNS: RegExp[] = [
  /levantamento\s+terra|deadlift/i,
  /agachamento\s+(hack|p[êe]ndulo|livre)/i,
  /flex[ãa]o\s+n[óo]rdica|nordic\s+curl/i,
  /\bbarra\s+fixa\b/i,
  /\bstiff\b/i,
  /paralela|mergulho\s+paralelas?/i,
  /push\s*up\s*trx/i,
];

type Signals = {
  methods: Set<string>;
  exercises: Set<string>;
  totalExercises: number;
  totalTemplates: number;
  hasCardio: boolean;
};

function collectSignals(parsed: ParsedFile): Signals {
  const methods = new Set<string>();
  const exercises = new Set<string>();
  let total = 0;
  for (const t of parsed.templates) {
    for (const ex of t.exercicios) {
      total++;
      const haystack = `${ex.nome_original} ${ex.metodo ?? ''} ${ex.observacoes ?? ''}`;
      for (const rx of ADV_METHOD_PATTERNS) if (rx.test(haystack)) methods.add(rx.source);
      for (const rx of ADV_EXERCISE_PATTERNS) if (rx.test(ex.nome_original)) exercises.add(rx.source);
    }
  }
  return {
    methods, exercises,
    totalExercises: total,
    totalTemplates: parsed.templates.length,
    hasCardio: parsed.cardios.length > 0,
  };
}

function classify(parsed: ParsedFile): { nivel: Nivel; score: number; signals: Signals } {
  const sig = collectSignals(parsed);
  const score = (sig.methods.size * 2) + sig.exercises.size + (sig.hasCardio ? 2 : 0);
  let nivel: Nivel;
  if (score >= 8) nivel = 'avancado';
  else if (score >= 4) nivel = 'intermediario';
  else nivel = 'iniciante';
  return { nivel, score, signals: sig };
}

// ---------- Romanos ----------
const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [100,'C'],[90,'XC'],[50,'L'],[40,'XL'],
  [10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
];
function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`romano inválido: ${n}`);
  let s = ''; let x = n;
  for (const [v, sym] of ROMAN_TABLE) { while (x >= v) { s += sym; x -= v; } }
  return s;
}
function isProgramName(name: string): boolean {
  return /^Programa\s+(Iniciante|Intermedi[áa]rio|Avan[çc]ado)(\s+[IVXLC]+)?$/.test(name);
}
function programNameFor(nivel: Nivel, roman: string): string {
  return `Programa ${NIVEL_LABEL[nivel]} ${roman}`;
}

// Excel armazena "cadência" como fração de dia (time). Converte para "HH:MM:SS" legível.
function cadenciaToText(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const totalSec = Math.round(v * 86400);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  return norm(v) || null;
}

function toInt(v: any): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}
function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function textOrNull(v: any): string | null {
  const s = norm(v);
  return s ? s : null;
}

// ---------- Tipos do parser ----------
type ParsedExercise = {
  ordem: number;
  nome_original: string;
  series: number | null;
  reps: string | null;
  cadencia: string | null;
  intervalo_seg: number | null;
  metodo: string | null;
  observacoes: string | null;
  carga_sugerida: string | null;
  raw_row: any[];
};

type ParsedTemplate = {
  cor: string;
  semana_numero: number;
  microciclo_numero: number | null;
  nome_treino: string;
  ordem: number;
  exercicios: ParsedExercise[];
  observacoes?: string | null;
};

type ParsedCardio = {
  cor: string;        // sheet name
  bloco: string;      // nome do bloco aeróbico ex.: "Aeróbio contínuo escada"
  intensidade?: string | null;
  volume?: string | null;
  exercicio?: string | null;
};

type ParsedFile = {
  filePath: string;
  fileName: string;
  sha256: string;
  templates: ParsedTemplate[];
  cardios: ParsedCardio[];
  warnings: string[];
};

// ---------- Parser de um sheet de cor ----------
function parseColorSheet(rows: any[][], cor: string, fileWarnings: string[]): ParsedTemplate[] {
  const out: ParsedTemplate[] = [];
  const totalRows = rows.length;
  let i = 0;
  let ordinalSemana = 0; // contador para sheets sem "Nª Semana"

  while (i < totalRows) {
    const row = rows[i] || [];
    const first = norm(row[0]);
    if (!first) { i++; continue; }

    // Detecta possível título de bloco: linha com texto na col 0 e que NÃO é "Exercícios"
    // nem "Percepção Subjetiva". Em seguida deve haver uma linha de header.
    const isHeaderEx = RX_HEADER_EX.test(first);
    const isPSE = RX_PSE.test(first);
    if (isHeaderEx || isPSE) { i++; continue; }

    // Olhar próximas linhas para confirmar que é título (header dentro de 1-2 linhas)
    let headerIdx = -1;
    for (let k = i + 1; k <= Math.min(i + 2, totalRows - 1); k++) {
      const c0 = norm((rows[k] || [])[0]);
      if (RX_HEADER_EX.test(c0)) { headerIdx = k; break; }
    }
    if (headerIdx < 0) { i++; continue; }

    // Título do bloco
    const tituloBruto = first;
    const mSemana = tituloBruto.match(RX_SEMANA);
    let semanaNumero: number;
    if (mSemana) {
      semanaNumero = parseInt(mSemana[1], 10);
    } else {
      ordinalSemana += 1;
      semanaNumero = ordinalSemana;
    }
    if (!mSemana) {
      // Mesmo sem semana explícita, mantemos o contador alinhado se aparecer depois
      // (raro nos dados; documentamos via warning leve).
    }

    // Nome do treino: tudo após "Nª Semana" (se houver), senão título inteiro abreviado
    let nomeTreino: string;
    if (mSemana) {
      const after = tituloBruto.replace(RX_SEMANA, '').replace(/^[\s\-–—:|]+/, '').trim();
      nomeTreino = after || cor;
    } else {
      // "Alternado por grupo muscular - Treino A" -> "Treino A"
      const m2 = tituloBruto.match(/Treino\s+[A-Z0-9]+/i);
      nomeTreino = m2 ? m2[0] : tituloBruto.slice(0, 80);
    }

    // Tira o cabeçalho ('Exercícios ...') e itera linhas até linha vazia/PSE
    const exercicios: ParsedExercise[] = [];
    let j = headerIdx + 1;
    let ordemEx = 0;
    while (j < totalRows) {
      const r = rows[j] || [];
      const c0 = norm(r[0]);
      if (!c0) { j++; if (allEmpty(rows[j] || [])) break; continue; }
      if (RX_PSE.test(c0)) break;
      // Nova "1ª Semana" inicia outro bloco
      if (RX_SEMANA.test(c0) && c0.length < 80) break;
      // Outro título sem semana?
      if (looksLikeNewTitle(c0, rows[j+1])) break;

      ordemEx += 1;
      exercicios.push({
        ordem: ordemEx,
        nome_original: c0,
        series: toInt(r[1]),
        reps: textOrNull(r[2]),
        cadencia: cadenciaToText(r[3]),
        intervalo_seg: toInt(r[4]),
        metodo: textOrNull(r[5]),
        observacoes: textOrNull(r[6]),
        carga_sugerida: textOrNull(r[7]),
        raw_row: r,
      });
      j++;
    }

    if (exercicios.length === 0) {
      fileWarnings.push(`[${cor}] bloco "${tituloBruto}" (linha ${i+1}) sem exercícios detectados — pulado.`);
    } else {
      out.push({
        cor,
        semana_numero: semanaNumero,
        microciclo_numero: null,
        nome_treino: nomeTreino,
        ordem: out.length,
        exercicios,
      });
    }
    i = j;
  }

  return out;
}

function allEmpty(row: any[]): boolean {
  return !row.some(c => norm(c) !== '');
}
function looksLikeNewTitle(first: string, next: any[] | undefined): boolean {
  if (!next) return false;
  const nextFirst = norm(next[0] || '');
  return RX_HEADER_EX.test(nextFirst);
}

// ---------- Parser leve de cardio ----------
function parseCardioSheet(rows: any[][], cor: string): ParsedCardio[] {
  const out: ParsedCardio[] = [];
  let blocoAtual = 'Cardio';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const c0 = norm(r[0]);
    if (!c0) continue;
    const upper = c0.toUpperCase();
    // Cabeçalhos de bloco geralmente são linhas em CAIXA ALTA ou que iniciam com "Aeróbio" / nome do equipamento
    if (/^(AER[ÓO]BIO|TREINAMENTO|HIIT|ESCADA|BICICLETA|ESTEIRA|CAMINHADA)/i.test(c0) && upper === c0) {
      blocoAtual = c0;
      continue;
    }
    if (/^Intensidade\s*$/i.test(c0)) continue;
    // Linhas tipo "Leve/Mod." | | | "1200 DEGRAUS ou 20'"
    if (/^(leve|mod|vigorosa|alta|baixa|forte|m[áa]xima)/i.test(c0)) {
      out.push({
        cor,
        bloco: blocoAtual,
        intensidade: c0,
        volume: textOrNull(r[3]) || textOrNull(r[1]) || textOrNull(r[2]),
        exercicio: textOrNull(r[5]),
      });
    }
  }
  return out;
}

// ---------- Parser de arquivo ----------
function parseFile(filePath: string): ParsedFile {
  const fileName = basename(filePath);
  const sha = sha256OfFile(filePath);
  const wb = XLSX.readFile(filePath, { cellDates: false });

  const templates: ParsedTemplate[] = [];
  const cardios: ParsedCardio[] = [];
  const warnings: string[] = [];

  for (const sn of wb.SheetNames) {
    const key = normKey(sn);
    if (!sn || key === 'sistemas e métodos' || key === 'sistemas e metodos' || key.startsWith('sistemas')) continue;

    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null });

    if (CARDIO_SHEETS.has(key)) {
      cardios.push(...parseCardioSheet(rows, sn));
      continue;
    }
    if (COLOR_SHEETS.has(key)) {
      const t = parseColorSheet(rows, sn, warnings);
      templates.push(...t);
      continue;
    }
    // Sheets desconhecidos: ainda tentamos como cor, mas registramos warning
    const t = parseColorSheet(rows, sn, warnings);
    if (t.length > 0) {
      warnings.push(`Sheet "${sn}" não está na lista de cores conhecidas; tratada como cor.`);
      templates.push(...t);
    } else {
      warnings.push(`Sheet "${sn}" ignorada (nenhum bloco reconhecido).`);
    }
  }

  return { filePath, fileName, sha256: sha, templates, cardios, warnings };
}

// ---------- Persistência ----------
type ImportStats = {
  file: string;
  status: 'success' | 'skipped' | 'failed' | 'partial';
  rows_read: number;
  rows_imported: number;
  program_id?: number;
  program_nome?: string;
  nivel?: Nivel;
  warnings: string[];
};

async function persist(
  parsed: ParsedFile,
  decision: { nome: string; nivel: Nivel },
  opts: { force: boolean }
): Promise<ImportStats> {
  const stats: ImportStats = {
    file: parsed.fileName,
    status: 'success',
    rows_read: parsed.templates.reduce((a, t) => a + t.exercicios.length, 0) + parsed.cardios.length,
    rows_imported: 0,
    program_nome: decision.nome,
    nivel: decision.nivel,
    warnings: [...parsed.warnings],
  };

  return await withClient(async (c) => {
    // Verifica idempotência via import_run
    if (!opts.force) {
      const prev = await c.query(
        `SELECT id, status FROM treinos.import_run WHERE source_sha256=$1 AND status='success' LIMIT 1`,
        [parsed.sha256]
      );
      if ((prev.rowCount ?? 0) > 0) {
        stats.status = 'skipped';
        stats.warnings.push(`Já importado com sucesso (sha256 ${parsed.sha256.slice(0,12)}…). Use --force para reimportar.`);
        return stats;
      }
    }

    // Abre import_run em "running"
    const runId = (await c.query(
      `INSERT INTO treinos.import_run (file_name, source_sha256, status, rows_read)
       VALUES ($1, $2, 'running', $3) RETURNING id`,
      [parsed.fileName, parsed.sha256, stats.rows_read]
    )).rows[0].id as number;

    try {
      await c.query('BEGIN');

      const duracaoSemanas = Math.max(1, ...parsed.templates.map(t => t.semana_numero));

      // Estratégia idempotente: localiza por source_sha256 (mesmo conteúdo),
      // depois cai para UPSERT por nome. Isso permite RENOMEAR programas
      // existentes (ex.: migração para o padrão "Programa <Cat> <Roman>")
      // sem criar duplicatas.
      let programId: number;
      const bySha = (await c.query(
        `SELECT id FROM treinos.program WHERE source_sha256 = $1 LIMIT 1`,
        [parsed.sha256]
      )).rows[0];
      if (bySha) {
        programId = bySha.id as number;
        await c.query(
          `UPDATE treinos.program
              SET nome = $2, nivel = $3, duracao_semanas = $4,
                  source_file = $5, updated_at = now()
            WHERE id = $1`,
          [programId, decision.nome, decision.nivel, duracaoSemanas, parsed.fileName]
        );
      } else {
        const ins = await c.query(
          `INSERT INTO treinos.program (nome, nivel, duracao_semanas, source_file, source_sha256)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (nome) DO UPDATE
              SET nivel           = EXCLUDED.nivel,
                  duracao_semanas = EXCLUDED.duracao_semanas,
                  source_file     = EXCLUDED.source_file,
                  source_sha256   = EXCLUDED.source_sha256,
                  updated_at      = now()
           RETURNING id`,
          [decision.nome, decision.nivel, duracaoSemanas, parsed.fileName, parsed.sha256]
        );
        programId = ins.rows[0].id as number;
      }
      stats.program_id = programId;

      // UPSERT semanas
      const semanas = new Set(parsed.templates.map(t => t.semana_numero));
      for (const s of semanas) {
        await c.query(
          `INSERT INTO treinos.program_week (program_id, semana_numero)
           VALUES ($1, $2)
           ON CONFLICT (program_id, semana_numero) DO NOTHING`,
          [programId, s]
        );
      }

      // Para cada template: workout_template + prescriptions
      for (const t of parsed.templates) {
        const tpl = (await c.query(
          `INSERT INTO treinos.workout_template
              (program_id, semana_numero, cor, nome_treino, ordem)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (program_id, semana_numero, cor, nome_treino)
             DO UPDATE SET ordem = EXCLUDED.ordem, updated_at = now()
           RETURNING id`,
          [programId, t.semana_numero, t.cor, t.nome_treino, t.ordem]
        )).rows[0];
        const templateId = tpl.id as number;

        // Limpa prescrições antigas deste template para garantir idempotência
        // (preserva audit trail via import_run; prescrições não são referenciadas
        //  por sessões anteriores de execução — apenas opcionalmente via prescription_id
        //  que é SET NULL on delete).
        await c.query(`DELETE FROM treinos.exercise_prescription WHERE workout_template_id = $1`, [templateId]);

        for (const ex of t.exercicios) {
          const exId = await resolveExercise(c, ex.nome_original, 'forca');
          await c.query(
            `INSERT INTO treinos.exercise_prescription
                (workout_template_id, exercise_catalog_id, ordem, series, reps, cadencia,
                 intervalo_seg, metodo, observacoes, carga_sugerida, nome_original, raw_row)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              templateId, exId, ex.ordem, ex.series, ex.reps, ex.cadencia,
              ex.intervalo_seg, ex.metodo, ex.observacoes, ex.carga_sugerida,
              ex.nome_original, JSON.stringify(ex.raw_row)
            ]
          );
          stats.rows_imported += 1;
        }
      }

      // Cardio: criamos um workout_template "Cardio" na semana 1 com prescrições mínimas.
      if (parsed.cardios.length > 0) {
        const cardioTpl = (await c.query(
          `INSERT INTO treinos.workout_template (program_id, semana_numero, cor, nome_treino, ordem)
           VALUES ($1, 1, 'Cardiorrespiratório', 'Cardio', 999)
           ON CONFLICT (program_id, semana_numero, cor, nome_treino)
             DO UPDATE SET updated_at = now()
           RETURNING id`,
          [programId]
        )).rows[0];
        const cardioTplId = cardioTpl.id as number;
        await c.query(`DELETE FROM treinos.exercise_prescription WHERE workout_template_id = $1`, [cardioTplId]);

        let ordem = 0;
        for (const cd of parsed.cardios) {
          ordem += 1;
          // Tenta inferir o exercício a partir do bloco (ex.: "AERÓBIO LONGO NA BICICLETA" -> "Bicicleta")
          const inferred = inferCardioExercise(cd.bloco) || cd.exercicio || 'Cardio';
          const exId = await resolveExercise(c, inferred, 'cardio');
          await c.query(
            `INSERT INTO treinos.exercise_prescription
                (workout_template_id, exercise_catalog_id, ordem, series, reps, intervalo_seg,
                 metodo, observacoes, carga_sugerida, nome_original, raw_row)
             VALUES ($1,$2,$3,NULL,$4,NULL,$5,$6,$7,$8,$9)`,
            [cardioTplId, exId, ordem, cd.volume, cd.bloco, cd.intensidade, cd.intensidade, inferred, JSON.stringify(cd)]
          );
          stats.rows_imported += 1;
        }
      }

      await c.query('COMMIT');

      await c.query(
        `UPDATE treinos.import_run
            SET finished_at = now(), rows_imported = $2, status = 'success',
                log = $3::jsonb
          WHERE id = $1`,
        [runId, stats.rows_imported, JSON.stringify({ warnings: stats.warnings, program_id: stats.program_id })]
      );
      return stats;
    } catch (e: any) {
      await c.query('ROLLBACK');
      await c.query(
        `UPDATE treinos.import_run
            SET finished_at = now(), status = 'failed',
                log = $2::jsonb
          WHERE id = $1`,
        [runId, JSON.stringify({ error: String(e?.message || e), warnings: stats.warnings })]
      );
      stats.status = 'failed';
      stats.warnings.push(`ERRO: ${String(e?.message || e)}`);
      return stats;
    }
  });
}

function inferCardioExercise(bloco: string): string | null {
  const s = bloco.toUpperCase();
  if (s.includes('ESCADA')) return 'Escada';
  if (s.includes('BICICLETA') || s.includes('BIKE')) return 'Bicicleta';
  if (s.includes('ESTEIRA') || s.includes('CORRIDA')) return 'Esteira';
  if (s.includes('CAMINHADA')) return 'Caminhada';
  return null;
}

// ---------- Catálogo / aliases ----------
async function resolveExercise(c: any, nomeOriginal: string, tipoDefault: 'forca'|'cardio'): Promise<number> {
  const key = normKey(nomeOriginal);
  // 1) alias_norm
  const aliasHit = await c.query(
    `SELECT exercise_catalog_id AS id FROM treinos.exercise_alias WHERE alias_norm = $1 LIMIT 1`,
    [key]
  );
  if ((aliasHit.rowCount ?? 0) > 0) return aliasHit.rows[0].id as number;

  // 2) catálogo direto (lowercase de nome_padrao)
  const catHit = await c.query(
    `SELECT id FROM treinos.exercise_catalog WHERE lower(nome_padrao) = $1 LIMIT 1`,
    [key]
  );
  if ((catHit.rowCount ?? 0) > 0) {
    // garante alias para futuras buscas
    await ensureAlias(c, catHit.rows[0].id, nomeOriginal, 'derived');
    return catHit.rows[0].id as number;
  }

  // 3) cria novo no catálogo + alias
  const created = await c.query(
    `INSERT INTO treinos.exercise_catalog (nome_padrao, tipo) VALUES ($1, $2) RETURNING id`,
    [norm(nomeOriginal), tipoDefault]
  );
  const newId = created.rows[0].id as number;
  await ensureAlias(c, newId, nomeOriginal, 'importer');
  return newId;
}

async function ensureAlias(c: any, catalogId: number, alias: string, origem: string) {
  await c.query(
    `INSERT INTO treinos.exercise_alias (exercise_catalog_id, alias, origem)
     VALUES ($1, $2, $3)
     ON CONFLICT (alias_norm) DO NOTHING`,
    [catalogId, norm(alias), origem]
  );
}

async function seedAliases() {
  const seedPath = resolve(__dirname, '..', '..', 'scripts', 'aliases.json');
  // Tenta caminho relativo a dist/ também
  const candidates = [
    resolve(__dirname, '..', '..', 'scripts', 'aliases.json'),  // dist/scripts -> .../scripts
    resolve(__dirname, '..', 'scripts', 'aliases.json'),        // dist -> .../scripts (improvável)
    resolve(__dirname, 'aliases.json'),                         // mesma pasta
    resolve(process.cwd(), 'scripts', 'aliases.json'),
    resolve(process.cwd(), 'src', 'api', 'scripts', 'aliases.json'),
  ];
  let path: string | null = null;
  for (const p of candidates) { if (existsSync(p)) { path = p; break; } }
  if (!path) { console.warn('[seed] aliases.json não encontrado — pulando seed.'); return; }

  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    aliases: Record<string, string[]>;
    catalog_hints?: Record<string, string[]>;
  };
  const groups = data.catalog_hints || {};

  await withClient(async (c) => {
    let createdEx = 0, createdAl = 0;
    for (const [canonical, aliases] of Object.entries(data.aliases)) {
      // grupo muscular?
      const grupo = Object.entries(groups).find(([, list]) => list.includes(canonical))?.[0] || null;
      const tipo = grupo === 'Cardio' ? 'cardio' : 'forca';
      const ins = await c.query(
        `INSERT INTO treinos.exercise_catalog (nome_padrao, grupo_muscular, tipo)
         VALUES ($1, $2, $3)
         ON CONFLICT (nome_padrao) DO UPDATE
           SET grupo_muscular = COALESCE(treinos.exercise_catalog.grupo_muscular, EXCLUDED.grupo_muscular),
               updated_at = now()
         RETURNING id, (xmax = 0) AS created`,
        [canonical, grupo, tipo]
      );
      const exId = ins.rows[0].id as number;
      if (ins.rows[0].created) createdEx += 1;
      // alias = nome canônico + variações
      const all = [canonical, ...aliases];
      for (const a of all) {
        const r = await c.query(
          `INSERT INTO treinos.exercise_alias (exercise_catalog_id, alias, origem)
           VALUES ($1, $2, 'seed')
           ON CONFLICT (alias_norm) DO NOTHING`,
          [exId, a]
        );
        if ((r.rowCount ?? 0) > 0) createdAl += 1;
      }
    }
    console.log(`[seed] catálogo: +${createdEx} novos; aliases: +${createdAl} novos.`);
  });
}

// ---------- Lista arquivos ----------
function listFiles(args: Args): string[] {
  if (args.file) return [resolve(args.file)];
  const dir = args.dir ? resolve(args.dir) : resolve(__dirname, '..', '..', '..', '..');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Diretório não encontrado: ${dir}`);
  }
  return readdirSync(dir)
    .filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map(f => join(dir, f));
}

// ---------- Main ----------
async function main() {
  const args = parseArgs(process.argv);
  const files = listFiles(args);
  if (files.length === 0) {
    console.error('Nenhum .xlsx encontrado. Use --dir <diretorio> ou --file <arquivo>.');
    process.exit(2);
  }
  console.log(`Importer de Treinos — modo: ${args.dryRun ? 'DRY-RUN' : 'PERSIST'}, force=${args.force}, seed=${args.seed}`);
  if (args.nivelOverride) console.log(`  override de nível: ${args.nivelOverride}`);
  console.log(`Arquivos: ${files.length}`);
  for (const f of files) console.log(`  - ${basename(f)}`);

  if (!args.dryRun && args.seed) {
    console.log('\n[seed] carregando aliases.json…');
    try { await seedAliases(); } catch (e: any) {
      console.warn(`[seed] falha (continuando): ${e?.message || e}`);
    }
  }

  // ---- Pass 1: parse + classifica todos os arquivos ----
  type Item = {
    file: string;
    parsed?: ParsedFile;
    parseError?: string;
    nivel?: Nivel;
    score?: number;
    signals?: Signals;
    existingId?: number;
    existingRoman?: string;
    decidedName?: string;
  };
  const items: Item[] = [];
  for (const f of files) {
    console.log(`\n=== ${basename(f)} ===`);
    const it: Item = { file: f };
    try {
      it.parsed = parseFile(f);
    } catch (e: any) {
      console.error(`ERRO no parse: ${e?.message || e}`);
      it.parseError = String(e?.message || e);
      items.push(it);
      continue;
    }
    const cls = classify(it.parsed);
    it.nivel = args.nivelOverride ?? cls.nivel;
    it.score = cls.score;
    it.signals = cls.signals;
    console.log(`  arquivo-fonte: ${basename(it.parsed.fileName)} (sha256 ${it.parsed.sha256.slice(0,12)}…)`);
    console.log(`  templates: ${it.parsed.templates.length} | exercícios: ${it.parsed.templates.reduce((a,t)=>a+t.exercicios.length,0)} | cardios: ${it.parsed.cardios.length}`);
    console.log(`  classificação: ${it.nivel} (score=${cls.score}; métodos=${cls.signals.methods.size}, ex.avançados=${cls.signals.exercises.size})${args.nivelOverride ? ' [override]' : ''}`);
    if (it.parsed.warnings.length) {
      console.log(`  warnings (${it.parsed.warnings.length}):`);
      for (const w of it.parsed.warnings.slice(0, 10)) console.log(`    · ${w}`);
      if (it.parsed.warnings.length > 10) console.log(`    · …+${it.parsed.warnings.length-10} mais`);
    }
    items.push(it);
  }

  // ---- Pass 2: atribuir romanos por categoria, respeitando o DB ----
  // Buscamos no DB:
  //   - mapping sha256 -> {id, nome, nivel}  para PRESERVAR o romano de um programa
  //     já existente que continua na mesma categoria.
  //   - lista de romanos já usados em CADA categoria (para não colidir).
  type ExistingByCat = { roman: number; nivel: Nivel };
  const existingBySha = new Map<string, { id: number; nome: string; nivel: Nivel }>();
  const usedRomanByNivel: Record<Nivel, Set<number>> = {
    iniciante: new Set(), intermediario: new Set(), avancado: new Set(),
  };
  if (!args.dryRun) {
    const shas = items.map(i => i.parsed?.sha256).filter(Boolean) as string[];
    if (shas.length) {
      const r = await withClient(async (c) => c.query(
        `SELECT id, nome, nivel, source_sha256 FROM treinos.program WHERE source_sha256 = ANY($1::text[])`,
        [shas]
      ));
      for (const row of r.rows) {
        existingBySha.set(row.source_sha256, { id: row.id, nome: row.nome, nivel: row.nivel });
      }
    }
    const all = await withClient(async (c) => c.query(
      `SELECT nome, nivel FROM treinos.program`
    ));
    for (const row of all.rows) {
      const m = String(row.nome).match(/^Programa\s+(?:Iniciante|Intermedi[áa]rio|Avan[çc]ado)\s+([IVXLC]+)$/);
      if (m && (row.nivel as Nivel) in usedRomanByNivel) {
        const n = romanToInt(m[1]);
        if (n) usedRomanByNivel[row.nivel as Nivel].add(n);
      }
    }
  }

  // 2.a) reusa romano para arquivos já existentes na MESMA categoria
  const usedThisRun: Record<Nivel, Set<number>> = {
    iniciante: new Set(), intermediario: new Set(), avancado: new Set(),
  };
  for (const it of items) {
    if (!it.parsed || !it.nivel) continue;
    const existing = existingBySha.get(it.parsed.sha256);
    if (!existing) continue;
    const m = existing.nome.match(/^Programa\s+(?:Iniciante|Intermedi[áa]rio|Avan[çc]ado)\s+([IVXLC]+)$/);
    if (m && existing.nivel === it.nivel) {
      const n = romanToInt(m[1]);
      if (n && !usedThisRun[it.nivel].has(n)) {
        usedThisRun[it.nivel].add(n);
        it.existingId = existing.id;
        it.decidedName = programNameFor(it.nivel, toRoman(n));
      }
    } else {
      // mudou de categoria; trataremos abaixo
      it.existingId = existing.id;
    }
  }

  // 2.b) atribui o próximo romano livre para os demais
  for (const it of items) {
    if (!it.parsed || !it.nivel || it.decidedName) continue;
    const used = new Set<number>([...usedRomanByNivel[it.nivel], ...usedThisRun[it.nivel]]);
    let n = 1; while (used.has(n)) n++;
    usedThisRun[it.nivel].add(n);
    it.decidedName = programNameFor(it.nivel, toRoman(n));
  }

  // ---- Pass 3: persistir ----
  const allStats: ImportStats[] = [];
  for (const it of items) {
    const fn = basename(it.file);
    if (it.parseError || !it.parsed || !it.nivel || !it.decidedName) {
      allStats.push({ file: fn, status: 'failed', rows_read: 0, rows_imported: 0, warnings: [it.parseError ?? 'classificação ausente'] });
      continue;
    }
    console.log(`\n--> ${fn}: "${it.decidedName}" [${it.nivel}]`);

    if (args.dryRun) {
      allStats.push({
        file: fn, status: 'success',
        rows_read: it.parsed.templates.reduce((a,t)=>a+t.exercicios.length,0),
        rows_imported: 0,
        program_nome: it.decidedName,
        nivel: it.nivel,
        warnings: it.parsed.warnings,
      });
      continue;
    }

    try {
      const st = await persist(it.parsed, { nome: it.decidedName, nivel: it.nivel }, { force: args.force });
      console.log(`  -> status=${st.status}, importados=${st.rows_imported}, program_id=${st.program_id ?? '-'}`);
      allStats.push(st);
    } catch (e: any) {
      console.error(`  -> ERRO: ${e?.message || e}`);
      allStats.push({ file: fn, status: 'failed', rows_read: 0, rows_imported: 0, warnings: [String(e?.message || e)] });
    }
  }

  console.log('\n========== RESUMO ==========');
  for (const s of allStats) {
    const tag = s.program_nome ? `${s.program_nome} [${s.nivel}]` : '-';
    console.log(`  ${s.status.padEnd(8)} ${String(s.rows_imported).padStart(5)} linhas | ${s.file}  ${tag}`);
  }
  const failed = allStats.filter(s => s.status === 'failed').length;
  await endPool();
  process.exit(failed > 0 ? 1 : 0);
}

function romanToInt(s: string): number | null {
  const map: Record<string, number> = { I:1, V:5, X:10, L:50, C:100 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = map[s[i]]; const next = map[s[i+1]];
    if (!v) return null;
    if (next && next > v) { total += (next - v); i++; }
    else total += v;
  }
  return total > 0 ? total : null;
}

main().catch(async (e) => {
  console.error('FATAL:', e?.stack || e);
  try { await endPool(); } catch {}
  process.exit(1);
});
