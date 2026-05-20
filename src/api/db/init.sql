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
