# APEX · 90D Recomp App

Personal body recomposition coach app — PWA + REST API + PostgreSQL on Azure.

## Stack

- **Frontend:** Static Web App (Free tier) — single-page PWA, Chart.js, vanilla JS
- **Backend:** Azure Functions (Node.js 20, TypeScript) — HTTP triggers
- **Database:** PostgreSQL Flexible Server (B1ms, 128 GB Premium SSD P10) — Entra-only auth
- **Region:** Central US
- **CI/CD:** GitHub Actions via `azd pipeline config` (OIDC, no secrets)

## Local Development

```bash
# API
cd src/api
cp local.settings.json.example local.settings.json
npm install
npm run build
func start   # http://localhost:7071

# Web
cd src/web
npx http-server -p 4280   # http://localhost:4280
# Or use SWA CLI for combined experience:
npx @azure/static-web-apps-cli start ./src/web --api-location ./src/api
```

## Deploy

```bash
azd auth login
azd env new apex-dev
azd env set AZURE_LOCATION centralus
azd env set POSTGRES_ADMIN_OBJECT_ID <your-entra-object-id>
azd env set POSTGRES_ADMIN_LOGIN <your-entra-upn>
azd up
```

After provision, apply schema:
```bash
ACCESS_TOKEN=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)
PGPASSWORD=$ACCESS_TOKEN psql -h <pg-fqdn> -U <your-upn> -d apex -f src/api/db/init.sql
```

## Project Structure

See [`.azure/deployment-plan.md`](./.azure/deployment-plan.md) for full architecture and decisions.

## Migration Notes

`src/web/index.html` was migrated from `C:\Trainner\nutri\guia.html` (v6, single-file). Currently still uses `localStorage`. Phase 2 work: refactor `state` persistence layer to call `/api/evol` while keeping localStorage as offline cache.
