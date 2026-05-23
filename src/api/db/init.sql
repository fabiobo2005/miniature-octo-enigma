-- APEX schema v8 (multiusuário)
-- Auto-aplicado em cada start da API. Idempotente.
-- 3 áreas isoladas em schemas separados + schema 'app' transversal (usuários, migrations).

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS saude;
CREATE SCHEMA IF NOT EXISTS dieta;
CREATE SCHEMA IF NOT EXISTS treinos;

-- ============ MIGRATION TRACKING ============
CREATE TABLE IF NOT EXISTS app.schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ MIGRATION v3-multiuser ============
-- Drop legacy single-user tables. Idempotent via migrations registry.
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v3-multiuser') THEN
    -- legacy public.* (caso ainda exista de v1)
    DROP TABLE IF EXISTS public.evolution CASCADE;
    DROP TABLE IF EXISTS public.supplement_log CASCADE;
    DROP TABLE IF EXISTS public.supplement CASCADE;
    DROP TABLE IF EXISTS public.meal_log CASCADE;
    DROP TABLE IF EXISTS public.workout_log CASCADE;
    -- v6/v7 single-user
    DROP TABLE IF EXISTS saude.evolution CASCADE;
    DROP TABLE IF EXISTS saude.supplement_log CASCADE;
    DROP TABLE IF EXISTS saude.supplement CASCADE;
    DROP TABLE IF EXISTS dieta.meal_log CASCADE;
    DROP TABLE IF EXISTS treinos.workout_log CASCADE;
    INSERT INTO app.schema_migrations(version) VALUES ('v3-multiuser');
  END IF;
END $mig$;

-- ============ APP (transversal) ============
CREATE TABLE IF NOT EXISTS app.user (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  avatar_url  TEXT,
  birth_date  DATE,
  height_cm   INTEGER,
  goal        TEXT,                       -- ex.: "recomp 90d", "ganho de massa"
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_active ON app.user(active) WHERE active = TRUE;

-- ============ SAUDE ============
CREATE TABLE IF NOT EXISTS saude.evolution (
  user_id       UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  measured_on   DATE NOT NULL,
  peso          NUMERIC(5,2),
  bf            NUMERIC(5,2),
  mm            NUMERIC(5,2),
  visc          INTEGER,
  agua          NUMERIC(5,2),
  mskel         NUMERIC(5,2),
  gsub          NUMERIC(5,2),
  osso          NUMERIC(4,1),
  prot          NUMERIC(5,2),
  tmb           INTEGER,
  idade_corpo   INTEGER,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, measured_on)
);
CREATE INDEX IF NOT EXISTS idx_evolution_user_date ON saude.evolution(user_id, measured_on DESC);

CREATE TABLE IF NOT EXISTS saude.supplement (
  id           SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  dose         TEXT,
  schedule     TEXT,
  color        TEXT DEFAULT '#7BC4A4',
  icon         TEXT DEFAULT '💊',
  notes        TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supp_user ON saude.supplement(user_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS saude.supplement_log (
  id             SERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  supplement_id  INTEGER NOT NULL REFERENCES saude.supplement(id) ON DELETE CASCADE,
  taken_on       DATE NOT NULL,
  taken_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_time TEXT,
  status         TEXT NOT NULL DEFAULT 'taken' CHECK (status IN ('taken','skipped'))
);
CREATE INDEX IF NOT EXISTS idx_supp_log_user_date ON saude.supplement_log(user_id, taken_on DESC);
CREATE INDEX IF NOT EXISTS idx_supp_log_sid       ON saude.supplement_log(supplement_id);

-- ============ DIETA ============
CREATE TABLE IF NOT EXISTS dieta.meal_log (
  user_id      UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  logged_on    DATE NOT NULL,
  meal_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('done','partial','skipped')),
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, logged_on, meal_id)
);
CREATE INDEX IF NOT EXISTS idx_meal_log_user_date ON dieta.meal_log(user_id, logged_on DESC);

-- Perfil de dieta opcional (kcal alvo, refeições/dia, plano)
CREATE TABLE IF NOT EXISTS dieta.profile (
  user_id        UUID PRIMARY KEY REFERENCES app.user(id) ON DELETE CASCADE,
  kcal_target    INTEGER,
  meals_per_day  INTEGER NOT NULL DEFAULT 6,
  plan_source    TEXT,
  started_on     DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ TREINOS ============
CREATE TABLE IF NOT EXISTS treinos.workout_log (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  trained_on    DATE NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  duration_min  INTEGER,
  intensity     TEXT CHECK (intensity IN ('leve','moderado','forte','maximo')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workout_user_date ON treinos.workout_log(user_id, trained_on DESC);

-- ============================================================================
-- MIGRATION v8-programas-treino
-- Programas de treino: catálogo, prescrição, execução por série, painel coach.
-- Cria todas as tabelas como IF NOT EXISTS para ser seguro mesmo se a entrada
-- da migration não for encontrada (idempotente em ambos os caminhos).
-- ============================================================================

-- ---------- Catálogo de exercícios ----------
CREATE TABLE IF NOT EXISTS treinos.exercise_catalog (
  id               SERIAL PRIMARY KEY,
  nome_padrao      TEXT NOT NULL UNIQUE,
  grupo_muscular   TEXT,
  equipamento      TEXT,
  tipo             TEXT NOT NULL DEFAULT 'forca' CHECK (tipo IN ('forca','cardio','mobilidade','core')),
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_excat_grupo ON treinos.exercise_catalog(grupo_muscular) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_excat_tipo  ON treinos.exercise_catalog(tipo)           WHERE ativo = TRUE;

CREATE TABLE IF NOT EXISTS treinos.exercise_alias (
  id                   SERIAL PRIMARY KEY,
  exercise_catalog_id  INTEGER NOT NULL REFERENCES treinos.exercise_catalog(id) ON DELETE CASCADE,
  alias                TEXT NOT NULL,
  alias_norm           TEXT GENERATED ALWAYS AS (lower(btrim(alias))) STORED,
  origem               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exalias_norm ON treinos.exercise_alias(alias_norm);
CREATE INDEX        IF NOT EXISTS idx_exalias_cat ON treinos.exercise_alias(exercise_catalog_id);

CREATE TABLE IF NOT EXISTS treinos.exercise_media (
  id                   SERIAL PRIMARY KEY,
  exercise_catalog_id  INTEGER NOT NULL REFERENCES treinos.exercise_catalog(id) ON DELETE CASCADE,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('video','gif','img')),
  url                  TEXT NOT NULL,
  duracao_seg          INTEGER,
  thumbnail            TEXT,
  ordem                INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exmedia_cat ON treinos.exercise_media(exercise_catalog_id);

-- ---------- Programa ----------
CREATE TABLE IF NOT EXISTS treinos.program (
  id                SERIAL PRIMARY KEY,
  nome              TEXT NOT NULL,
  objetivo          TEXT,
  duracao_semanas   INTEGER NOT NULL CHECK (duracao_semanas BETWEEN 1 AND 52),
  nivel             TEXT NOT NULL CHECK (nivel IN ('iniciante','intermediario','avancado')),
  autor_user_id     UUID REFERENCES app.user(id) ON DELETE SET NULL,
  source_file       TEXT,
  source_sha256     TEXT,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_nome      ON treinos.program(nome);
CREATE        INDEX IF NOT EXISTS idx_program_ativo    ON treinos.program(ativo) WHERE ativo = TRUE;
CREATE        INDEX IF NOT EXISTS idx_program_autor    ON treinos.program(autor_user_id);

CREATE TABLE IF NOT EXISTS treinos.program_week (
  id                    SERIAL PRIMARY KEY,
  program_id            INTEGER NOT NULL REFERENCES treinos.program(id) ON DELETE CASCADE,
  semana_numero         INTEGER NOT NULL CHECK (semana_numero BETWEEN 1 AND 52),
  microciclo_numero     INTEGER,
  observacoes           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_week ON treinos.program_week(program_id, semana_numero);

CREATE TABLE IF NOT EXISTS treinos.workout_template (
  id                SERIAL PRIMARY KEY,
  program_id        INTEGER NOT NULL REFERENCES treinos.program(id) ON DELETE CASCADE,
  semana_numero     INTEGER NOT NULL CHECK (semana_numero BETWEEN 1 AND 52),
  cor               TEXT NOT NULL,
  nome_treino       TEXT NOT NULL,
  ordem             INTEGER NOT NULL DEFAULT 0,
  observacoes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_template
  ON treinos.workout_template(program_id, semana_numero, cor, nome_treino);
CREATE INDEX IF NOT EXISTS idx_wtemplate_prog_semana
  ON treinos.workout_template(program_id, semana_numero);

CREATE TABLE IF NOT EXISTS treinos.exercise_prescription (
  id                    SERIAL PRIMARY KEY,
  workout_template_id   INTEGER NOT NULL REFERENCES treinos.workout_template(id) ON DELETE CASCADE,
  exercise_catalog_id   INTEGER NOT NULL REFERENCES treinos.exercise_catalog(id) ON DELETE RESTRICT,
  ordem                 INTEGER NOT NULL DEFAULT 0,
  series                INTEGER,
  reps                  TEXT,
  cadencia              TEXT,
  intervalo_seg         INTEGER,
  metodo                TEXT,
  observacoes           TEXT,
  carga_sugerida        TEXT,
  nome_original         TEXT,
  raw_row               JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescription_template_ordem
  ON treinos.exercise_prescription(workout_template_id, ordem, exercise_catalog_id);
CREATE INDEX IF NOT EXISTS idx_prescription_template ON treinos.exercise_prescription(workout_template_id);
CREATE INDEX IF NOT EXISTS idx_prescription_exercise ON treinos.exercise_prescription(exercise_catalog_id);

-- ---------- Execução pelo aluno ----------
CREATE TABLE IF NOT EXISTS treinos.workout_session (
  id                    SERIAL PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  program_id            INTEGER REFERENCES treinos.program(id) ON DELETE SET NULL,
  workout_template_id   INTEGER REFERENCES treinos.workout_template(id) ON DELETE SET NULL,
  semana_numero         INTEGER,
  data                  DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ,
  duracao_min           INTEGER,
  pse                   INTEGER CHECK (pse BETWEEN 0 AND 10),
  unidades_arbitrarias  NUMERIC(8,2),
  carga_total           NUMERIC(10,2),
  status                TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','finished','aborted')),
  observacoes           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_user_data    ON treinos.workout_session(user_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_session_program      ON treinos.workout_session(program_id);
CREATE INDEX IF NOT EXISTS idx_session_template     ON treinos.workout_session(workout_template_id);

CREATE TABLE IF NOT EXISTS treinos.exercise_execution (
  id                    SERIAL PRIMARY KEY,
  workout_session_id    INTEGER NOT NULL REFERENCES treinos.workout_session(id) ON DELETE CASCADE,
  exercise_catalog_id   INTEGER NOT NULL REFERENCES treinos.exercise_catalog(id) ON DELETE RESTRICT,
  prescription_id       INTEGER REFERENCES treinos.exercise_prescription(id) ON DELETE SET NULL,
  ordem                 INTEGER NOT NULL DEFAULT 0,
  concluido             BOOLEAN NOT NULL DEFAULT FALSE,
  observacao_aluno      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_session_ex
  ON treinos.exercise_execution(workout_session_id, exercise_catalog_id, ordem);
CREATE INDEX IF NOT EXISTS idx_execution_session ON treinos.exercise_execution(workout_session_id);

CREATE TABLE IF NOT EXISTS treinos.set_execution (
  id                       SERIAL PRIMARY KEY,
  exercise_execution_id    INTEGER NOT NULL REFERENCES treinos.exercise_execution(id) ON DELETE CASCADE,
  set_numero               INTEGER NOT NULL CHECK (set_numero BETWEEN 1 AND 50),
  reps                     INTEGER,
  carga                    NUMERIC(7,2),
  rpe                      NUMERIC(3,1) CHECK (rpe IS NULL OR (rpe >= 0 AND rpe <= 10)),
  tempo_seg                INTEGER,
  observacoes              TEXT,
  registered_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_setexec_unique
  ON treinos.set_execution(exercise_execution_id, set_numero);
CREATE INDEX IF NOT EXISTS idx_setexec_exec ON treinos.set_execution(exercise_execution_id);

-- ---------- Coach / personal ----------
CREATE TABLE IF NOT EXISTS treinos.coach_assignment (
  id              SERIAL PRIMARY KEY,
  coach_user_id   UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  aluno_user_id   UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','encerrado')),
  started_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_on        DATE,
  observacoes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coach_user_id <> aluno_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coach_assign_pair
  ON treinos.coach_assignment(coach_user_id, aluno_user_id) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS idx_coach_assign_coach ON treinos.coach_assignment(coach_user_id);
CREATE INDEX IF NOT EXISTS idx_coach_assign_aluno ON treinos.coach_assignment(aluno_user_id);

CREATE TABLE IF NOT EXISTS treinos.coach_feedback (
  id                    SERIAL PRIMARY KEY,
  coach_user_id         UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  aluno_user_id         UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  workout_session_id    INTEGER REFERENCES treinos.workout_session(id) ON DELETE SET NULL,
  texto                 TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_aluno   ON treinos.coach_feedback(aluno_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON treinos.coach_feedback(workout_session_id);

-- ---------- Timer e cues de áudio (schema mínimo, sem UI nesta fase) ----------
CREATE TABLE IF NOT EXISTS treinos.timer_preset (
  id              SERIAL PRIMARY KEY,
  user_id         UUID REFERENCES app.user(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  intervalo_seg   INTEGER NOT NULL CHECK (intervalo_seg > 0),
  beep_inicio     BOOLEAN NOT NULL DEFAULT TRUE,
  beep_fim        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timer_preset_user ON treinos.timer_preset(user_id);

CREATE TABLE IF NOT EXISTS treinos.audio_cue_profile (
  id              SERIAL PRIMARY KEY,
  user_id         UUID REFERENCES app.user(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'beep' CHECK (provider IN ('beep','spotify','apple_music','custom')),
  config          JSONB,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audio_cue_user ON treinos.audio_cue_profile(user_id);

-- ---------- Auditoria do importer ----------
CREATE TABLE IF NOT EXISTS treinos.import_run (
  id              SERIAL PRIMARY KEY,
  file_name       TEXT NOT NULL,
  source_sha256   TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  rows_read       INTEGER NOT NULL DEFAULT 0,
  rows_imported   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','success','partial','failed','skipped')),
  log             JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_run_sha   ON treinos.import_run(source_sha256) WHERE status = 'success';
CREATE INDEX        IF NOT EXISTS idx_import_run_file ON treinos.import_run(file_name, started_at DESC);

-- ---------- Trigger genérico de updated_at (reaproveitado) ----------
CREATE OR REPLACE FUNCTION treinos.tg_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $tg$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'exercise_catalog','program','workout_template',
    'workout_session','exercise_execution','coach_assignment'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON treinos.%1$s;
      CREATE TRIGGER trg_%1$s_updated_at
        BEFORE UPDATE ON treinos.%1$s
        FOR EACH ROW EXECUTE FUNCTION treinos.tg_set_updated_at();
    $f$, t);
  END LOOP;
END $tg$;

-- Registra migração (idempotente)
INSERT INTO app.schema_migrations(version)
  VALUES ('v8-programas-treino')
  ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- MIGRATION v8.1-program-nivel-not-null
-- Torna treinos.program.nivel obrigatório. A classificação passa a ser
-- mandatória no importer (iniciante / intermediario / avancado).
-- ============================================================================
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v8.1-program-nivel-not-null') THEN
    -- Caso existam linhas legadas com nivel NULL, classifica como 'intermediario'
    -- por segurança; o importer reclassificará no próximo run.
    UPDATE treinos.program SET nivel = 'intermediario' WHERE nivel IS NULL;
    ALTER TABLE treinos.program ALTER COLUMN nivel SET NOT NULL;
    INSERT INTO app.schema_migrations(version) VALUES ('v8.1-program-nivel-not-null');
  END IF;
END $mig$;

-- ============================================================================
-- MIGRATION v9-role-and-program-assignment
-- 1) Adiciona coluna `role` em app.user (aluno/personal)
-- 2) Cria tabela treinos.program_assignment para vincular aluno ao programa
--    em execução, permitindo calcular semana atual e sugerir próximo treino.
-- ============================================================================
DO $mig9$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v9-role-and-program-assignment') THEN

    -- 1) role
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='app' AND table_name='user' AND column_name='role'
    ) THEN
      ALTER TABLE app."user"
        ADD COLUMN role TEXT NOT NULL DEFAULT 'aluno'
          CHECK (role IN ('aluno','personal'));
      CREATE INDEX IF NOT EXISTS idx_user_role ON app."user"(role) WHERE active = TRUE;
    END IF;

    -- Backfill: quem tem goal começando com "Personal" vira personal
    UPDATE app."user"
       SET role = 'personal'
     WHERE COALESCE(goal,'') ILIKE 'Personal%'
       AND role <> 'personal';

    -- 2) program_assignment
    CREATE TABLE IF NOT EXISTS treinos.program_assignment (
      id              SERIAL PRIMARY KEY,
      aluno_user_id   UUID NOT NULL REFERENCES app."user"(id) ON DELETE CASCADE,
      program_id      INTEGER NOT NULL REFERENCES treinos.program(id) ON DELETE CASCADE,
      coach_user_id   UUID REFERENCES app."user"(id) ON DELETE SET NULL,
      started_on      DATE NOT NULL DEFAULT CURRENT_DATE,
      ended_on        DATE,
      status          TEXT NOT NULL DEFAULT 'ativo'
                       CHECK (status IN ('ativo','concluido','cancelado','pausado','encerrado')),
      source          TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self','coach')),
      observacoes     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- 1 atribuição ATIVA por aluno
    CREATE UNIQUE INDEX IF NOT EXISTS uq_program_assign_aluno_ativo
      ON treinos.program_assignment(aluno_user_id) WHERE status = 'ativo';
    CREATE INDEX IF NOT EXISTS idx_program_assign_program ON treinos.program_assignment(program_id);
    CREATE INDEX IF NOT EXISTS idx_program_assign_coach   ON treinos.program_assignment(coach_user_id);

    DROP TRIGGER IF EXISTS trg_program_assignment_updated_at ON treinos.program_assignment;
    CREATE TRIGGER trg_program_assignment_updated_at
      BEFORE UPDATE ON treinos.program_assignment
      FOR EACH ROW EXECUTE FUNCTION treinos.tg_set_updated_at();

    INSERT INTO app.schema_migrations(version) VALUES ('v9-role-and-program-assignment');
  END IF;
END $mig9$;

DO $mig10$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v10-program-assignment-source') THEN
    ALTER TABLE treinos.program_assignment
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'self';

    ALTER TABLE treinos.program_assignment
      DROP CONSTRAINT IF EXISTS program_assignment_status_check;
    ALTER TABLE treinos.program_assignment
      ADD CONSTRAINT program_assignment_status_check
        CHECK (status IN ('ativo','concluido','cancelado','pausado','encerrado'));

    ALTER TABLE treinos.program_assignment
      DROP CONSTRAINT IF EXISTS program_assignment_source_check;
    ALTER TABLE treinos.program_assignment
      ADD CONSTRAINT program_assignment_source_check
        CHECK (source IN ('self','coach'));

    INSERT INTO app.schema_migrations(version) VALUES ('v10-program-assignment-source');
  END IF;
END $mig10$;

-- ============================================================================
-- MIGRATION v14-subfase-h-program-assignment-source
-- Alinha program_assignment com a Sub-fase H: encerramento por coach e origem.
-- ============================================================================
DO $mig14$
DECLARE
  constraint_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v14-subfase-h-program-assignment-source') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='treinos' AND table_name='program_assignment' AND column_name='source'
    ) THEN
      ALTER TABLE treinos.program_assignment
        ADD COLUMN source TEXT NOT NULL DEFAULT 'self';
    END IF;

    SELECT conname INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = 'treinos.program_assignment'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
     LIMIT 1;

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE treinos.program_assignment DROP CONSTRAINT %I', constraint_name);
    END IF;

    ALTER TABLE treinos.program_assignment
      ADD CONSTRAINT program_assignment_status_check
      CHECK (status IN ('ativo','concluido','cancelado','pausado','encerrado'));

    ALTER TABLE treinos.program_assignment
      DROP CONSTRAINT IF EXISTS program_assignment_source_check;
    ALTER TABLE treinos.program_assignment
      ADD CONSTRAINT program_assignment_source_check
      CHECK (source IN ('self','coach'));

    INSERT INTO app.schema_migrations(version) VALUES ('v14-subfase-h-program-assignment-source');
  END IF;
END $mig14$;

-- ============================================================================
-- MIGRATION v15-entra-auth
-- Entra ID auth, admin role, pending/disabled workflow, and audit log.
-- ============================================================================
DO $mig15$
DECLARE
  constraint_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v15-entra-auth') THEN
    ALTER TABLE app."user" DROP CONSTRAINT IF EXISTS user_role_check;

    SELECT conname INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = 'app."user"'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%role%'
     LIMIT 1;

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE app."user" DROP CONSTRAINT %I', constraint_name);
    END IF;

    ALTER TABLE app."user"
      ADD CONSTRAINT user_role_check CHECK (role IN ('aluno','personal','admin'));

    ALTER TABLE app."user" ADD COLUMN IF NOT EXISTS entra_object_id TEXT;
    ALTER TABLE app."user" ADD COLUMN IF NOT EXISTS upn TEXT;
    ALTER TABLE app."user" ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('pending','active','disabled'));
    ALTER TABLE app."user" ADD COLUMN IF NOT EXISTS specialization TEXT;
    ALTER TABLE app."user" ADD COLUMN IF NOT EXISTS bio TEXT;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'app."user"'::regclass
         AND contype = 'u'
         AND conname = 'user_entra_object_id_key'
    ) THEN
      ALTER TABLE app."user" ADD CONSTRAINT user_entra_object_id_key UNIQUE (entra_object_id);
    END IF;

    CREATE INDEX IF NOT EXISTS idx_user_status ON app."user"(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entra_unique ON app."user"(entra_object_id) WHERE entra_object_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_user_entra ON app."user"(entra_object_id);

    UPDATE app."user"
       SET role='admin', status='active', name='MOD Administrator',
           entra_object_id='0afe4b17-3283-4e3d-978b-8c24ac4567eb',
           upn='admin@MngEnvMCAP198698.onmicrosoft.com'
     WHERE email='admin@MngEnvMCAP198698.onmicrosoft.com'
       AND entra_object_id IS NULL;

    INSERT INTO app."user" (id, name, email, role, status, entra_object_id, upn)
    VALUES (gen_random_uuid(), 'MOD Administrator', 'admin@MngEnvMCAP198698.onmicrosoft.com',
            'admin', 'active', '0afe4b17-3283-4e3d-978b-8c24ac4567eb', 'admin@MngEnvMCAP198698.onmicrosoft.com')
    ON CONFLICT (entra_object_id) DO UPDATE SET role='admin', status='active', name=EXCLUDED.name;

    CREATE TABLE IF NOT EXISTS app.audit_log (
      id          SERIAL PRIMARY KEY,
      actor_id    UUID,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      details     JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON app.audit_log(created_at DESC);

    INSERT INTO app.schema_migrations(version) VALUES ('v15-entra-auth');
  END IF;
END $mig15$;

-- ============================================================================
-- MIGRATION v16-leads
-- Captura de leads da landing page pública (pré-cadastro sem auth Entra).
-- ============================================================================
DO $mig16$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v16-leads') THEN
    CREATE TABLE IF NOT EXISTS app.lead (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL,
      email         TEXT NOT NULL,
      phone         TEXT,
      role_interest TEXT NOT NULL CHECK (role_interest IN ('aluno','personal','outro')),
      message       TEXT,
      source        TEXT,
      ip            TEXT,
      user_agent    TEXT,
      converted_user_id UUID REFERENCES app."user"(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_created ON app.lead(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lead_email ON app.lead(lower(email));
    INSERT INTO app.schema_migrations(version) VALUES ('v16-leads');
  END IF;
END $mig16$;

-- ============================================================================
-- MIGRATION v17-profession
-- Plataforma expandida para profissionais da saúde (nutri, fisio, personal, etc.).
-- ============================================================================
DO $mig17$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version='v17-profession') THEN
    ALTER TABLE app."user" ADD COLUMN IF NOT EXISTS profession TEXT;
    ALTER TABLE app.lead   ADD COLUMN IF NOT EXISTS profession TEXT;
    ALTER TABLE app.lead   ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
    ALTER TABLE app.lead   ADD COLUMN IF NOT EXISTS notes TEXT;
    CREATE INDEX IF NOT EXISTS idx_user_profession ON app."user"(profession) WHERE profession IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_lead_contacted ON app.lead(contacted_at);

    UPDATE app."user"
       SET profession = 'personal_trainer'
     WHERE role = 'personal' AND profession IS NULL;

    INSERT INTO app.schema_migrations(version) VALUES ('v17-profession');
  END IF;
END $mig17$;
