-- APEX schema (run after deploy with psql + Entra token)

CREATE TABLE IF NOT EXISTS evolution (
  measured_on   DATE PRIMARY KEY,
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
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evolution_date ON evolution(measured_on DESC);

-- Grant read/write to the API managed identity (replace placeholder)
-- This is automatically the role name = identity name (e.g. id-apex-xxxxx)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON evolution TO "id-apex-xxxxx";
