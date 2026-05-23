-- Cria role AAD para a managed identity da API
SELECT pgaadauth_create_principal('id-apex-wjmlu42txmyeo', false, false);

-- Concede schema/database
GRANT CONNECT ON DATABASE apex TO "id-apex-wjmlu42txmyeo";
GRANT CREATE ON DATABASE apex TO "id-apex-wjmlu42txmyeo";

-- Verifica
SELECT rolname FROM pg_roles WHERE rolname='id-apex-wjmlu42txmyeo';
