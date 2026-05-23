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

-- Seed personals (idempotente via email UNIQUE)
INSERT INTO app."user" (name, email, role, status, specialization, bio, active)
VALUES
  ('Fabio Oliveira', 'personal.fabio@apex.local', 'personal', 'active',
   'Hipertrofia e recomposição corporal',
   'Personal trainer com foco em programas estruturados de 5x/semana. Acompanhamento de evolução e ajustes semanais.', TRUE),
  ('Ana Lima', 'personal.ana@apex.local', 'personal', 'active',
   'Emagrecimento e condicionamento',
   'Treinos funcionais e cardio combinado. Atendimento individualizado para iniciantes e intermediários.', TRUE),
  ('Carlos Souza', 'personal.carlos@apex.local', 'personal', 'active',
   'Força e performance',
   'Powerlifting, força absoluta e progressão de carga. Preparação física para atletas amadores.', TRUE)
ON CONFLICT (email) DO UPDATE
   SET specialization = EXCLUDED.specialization,
       bio            = EXCLUDED.bio,
       role           = EXCLUDED.role,
       status         = EXCLUDED.status,
       active         = EXCLUDED.active;

SELECT id, name, role, status FROM app."user" WHERE role='personal' ORDER BY name;
