# APEX Cloud · Nutrição, Saúde e Treinos

APEX Cloud é uma PWA de acompanhamento de recomposição corporal com API REST e banco PostgreSQL no Azure. O produto organiza a experiência em três áreas principais:

- **Saúde:** evolução corporal, medidas, suplementos e histórico do aluno.
- **Dieta:** registro diário de refeições e aderência ao plano alimentar.
- **Treinos:** catálogo de programas, prescrição, execução de sessões, cronômetro/beeps e histórico de treino.
- **Portal do Personal:** visão de carteira, métricas de aderência, drill-down de alunos, atribuição/criação de programas e exportação CSV.

URL de produção: <https://ca-apex-web.calmbush-08b221f9.centralus.azurecontainerapps.io>

## Stack

- **API:** Express + TypeScript em Node.js 18+.
- **Web/PWA:** aplicação estática servida junto do container, com JavaScript vanilla e assets PWA.
- **Banco:** Azure Database for PostgreSQL com autenticação AAD/Entra.
- **Deploy:** Azure Developer CLI (`azd`) para Azure Container Apps (ACA).
- **Infra:** Container Apps + Postgres + configuração via variáveis de ambiente.

## Como rodar localmente

```bash
cd src/api
npm install
npm run dev
```

A API roda por padrão na porta configurada em `PORT` ou `3000`. Para desenvolvimento com banco real/local, configure as variáveis esperadas pela API (`DATABASE_URL` ou `PG_HOST`/`PG_DATABASE`/`PG_USER`/credenciais AAD conforme o ambiente).

## Smoke tests

```bash
cd src/api
npm run smoke
# ou contra outra URL
BASE_URL=http://localhost:3000 npm run smoke
```

O smoke test consulta endpoints públicos do catálogo de treinos/personals e tenta `/healthz` de forma opcional.
## Deploy

```bash
azd auth login
azd up
```

Para publicar alterações em um ambiente já provisionado:

```bash
azd deploy
```

## Estrutura de pastas

```text
.
├─ azure.yaml              # Configuração azd
├─ infra/                  # Infraestrutura Azure/Bicep
├─ docs/                   # Guias de uso e operação
├─ src/
│  ├─ api/                 # Express/TypeScript API, schema e scripts
│  │  ├─ db/init.sql       # Schema e migrations idempotentes
│  │  ├─ scripts/          # Importadores, seeds e smoke tests
│  │  └─ src/              # Server, rotas, db, schemas e middleware
│  └─ web/                 # PWA estática
└─ CHANGELOG.md            # Histórico de versões/fases
```

## Uso do produto

Consulte o guia completo em [docs/USAGE.md](./docs/USAGE.md).
