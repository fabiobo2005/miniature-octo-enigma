INSERT INTO app."user" (name, email, role, status, entra_object_id, upn, active)
VALUES ('Fabio Oliveira', 'faoliveira@MngEnvMCAP099013.onmicrosoft.com', 'admin', 'active', '2494dc35-2033-4eea-95bc-1461350d046e', 'faoliveira@MngEnvMCAP099013.onmicrosoft.com', TRUE)
ON CONFLICT (entra_object_id) DO UPDATE
  SET role='admin', status='active', active=TRUE,
      name=EXCLUDED.name, upn=EXCLUDED.upn, updated_at=now();
SELECT id, name, email, role, status, entra_object_id FROM app."user" WHERE entra_object_id='2494dc35-2033-4eea-95bc-1461350d046e';
