-- Aplica v17: profession nas tabelas user/lead
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

-- Atualiza seed de profissionais existentes com profissões variadas (para demo)
UPDATE app."user" SET profession='personal_trainer' WHERE email='personal.fabio@apex.local';
UPDATE app."user" SET profession='nutricionista',
                       name='Ana Lima',
                       specialization='Nutrição esportiva e emagrecimento',
                       bio='Nutricionista clínica e esportiva. Planos alimentares para emagrecimento, hipertrofia e performance.'
 WHERE email='personal.ana@apex.local';
UPDATE app."user" SET profession='fisioterapeuta',
                       name='Carlos Souza',
                       specialization='Reabilitação ortopédica e RPG',
                       bio='Fisioterapeuta esportivo com foco em reabilitação ortopédica, dores crônicas e retorno ao esporte.'
 WHERE email='personal.carlos@apex.local';

-- Adiciona mais profissionais para demonstrar a variedade
INSERT INTO app."user" (name, email, role, status, profession, specialization, bio, active)
VALUES
  ('Mariana Costa', 'personal.mariana@apex.local', 'personal', 'active', 'psicologo',
   'Psicologia do esporte e saúde mental',
   'Psicóloga com especialização em desempenho esportivo, ansiedade de performance e adesão a programas de saúde.', TRUE),
  ('Rafael Mendes', 'personal.rafael@apex.local', 'personal', 'active', 'educador_fisico',
   'Treinamento funcional e cross',
   'Educador físico especializado em treinamento funcional, cross training e preparação para corridas de rua.', TRUE),
  ('Patrícia Alves', 'personal.patricia@apex.local', 'personal', 'active', 'medico',
   'Medicina esportiva e nutrologia',
   'Médica do esporte e nutróloga. Avaliação clínica, exames laboratoriais e suplementação personalizada.', TRUE)
ON CONFLICT (email) DO UPDATE
   SET profession = EXCLUDED.profession,
       specialization = EXCLUDED.specialization,
       bio = EXCLUDED.bio,
       status = EXCLUDED.status,
       role = EXCLUDED.role,
       active = EXCLUDED.active;

SELECT name, profession, specialization FROM app."user" WHERE role='personal' ORDER BY name;
