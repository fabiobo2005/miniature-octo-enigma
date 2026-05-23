# Migração de ambiente Azure — APEX Cloud

Scripts PowerShell para migrar o APEX Cloud de uma subscription/tenant Azure para outra, incluindo dump/restore do Postgres, recriação do OIDC do GitHub Actions e atualização de referências hardcoded.

## Pré-requisitos

- Windows + PowerShell 5.1 ou 7+
- CLIs: `az`, `azd`, `gh`, `psql`, `pg_dump`, `docker`
- Acesso de **leitura** ao tenant antigo (para o dump) e **Owner/Contributor + User Access Admin** na nova subscription (para criar role assignments)
- Repositório clonado em `C:\Trainner\nutri\apex-cloud`

## Estado compartilhado

Os scripts trocam dados via `scripts/migration/.migration-state.json` (gitignored — não commite). Cada script lê o estado dos anteriores, então **rode em ordem**.

## Ordem de execução

| # | Script | O que faz | Em que tenant? |
|---|---|---|---|
| 00 | `00-prereqs.ps1` | Verifica CLIs instaladas | qualquer |
| 10 | `10-dump-old.ps1` | `pg_dump` do PG antigo (custom format) → `scripts/migration/backups/` | **antigo** (`az login --tenant <antigo>`) |
| 20 | `20-bootstrap-new.ps1` | Cria novo `azd env`, seta variáveis, roda `azd up` (provisiona tudo) | **novo** (`az login --tenant <novo>`) |
| 30 | `30-post-deploy.ps1` | Promove você como Entra admin do PG novo (passo obrigatório, não está no Bicep) | novo |
| 40 | `40-restore.ps1` | Libera teu IP no firewall, roda `pg_restore`, valida com `SELECT count` | novo |
| 50 | `50-github-oidc.ps1` | Cria app registration nova, federated credential, seta secrets do repo via `gh` | novo |
| 60 | `60-update-workflows.ps1` | Troca PG name, URL pública e RG hardcoded nos workflows/docs | local |
| 99 | `99-cleanup-old.ps1` | Apaga RG antigo (só rode depois de validar tudo) | antigo |

## Runbook resumido

```powershell
cd C:\Trainner\nutri\apex-cloud\scripts\migration

# 1. Verificar ferramentas
.\00-prereqs.ps1

# 2. Dump do antigo
az login --tenant <tenant-antigo>
.\10-dump-old.ps1

# 3. Provisionar novo
az logout
az login --tenant <tenant-novo>
.\20-bootstrap-new.ps1     # vai perguntar env name, location, etc.

# 4. Pós-deploy + restore
.\30-post-deploy.ps1
.\40-restore.ps1

# 5. GitHub Actions
gh auth login              # se não estiver autenticado
.\50-github-oidc.ps1
.\60-update-workflows.ps1

# 6. Validar: abrir new web URL, rodar smoke test
cd ..\..\src\api
$env:BASE_URL = (Get-Content ..\..\scripts\migration\.migration-state.json | ConvertFrom-Json).newWebUrl
npm run smoke

# 7. Commit das mudanças nos workflows/docs
cd ..\..
git add .github docs README.md CHANGELOG.md
git commit -m "chore: migrate to new Azure subscription"
git push

# 8. Cleanup (só depois de uns dias rodando OK)
cd scripts\migration
.\99-cleanup-old.ps1
```

## Troubleshooting

**`pg_dump: server certificate verification failed`**
→ Adicione `PGSSLMODE=require` (já está nos scripts). Se persistir, baixe o root CA: <https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking-ssl-tls>

**`azd up` falha em `acrRole` com "PrincipalNotFound"**
→ User-assigned identity ainda não propagou. Aguarde 30s e rode `azd provision` de novo.

**`pg_restore` com muitos warnings sobre roles**
→ Normal: o dump foi feito com `--no-owner --no-acl` mas algumas extensões/grants podem reclamar. Desde que o `SELECT count` no final mostre as tabelas, está OK.

**App não conecta no PG novo**
→ Verifique se o role da managed identity da API foi criado (o `db/init.sql` faz isso no start). Veja logs:
```powershell
az containerapp logs show -g <newRg> -n ca-apex-api --follow
```

**Federated credential já existe mas com subject errado**
→ Delete manualmente:
```powershell
az ad app federated-credential delete --id <appId> --federated-credential-id <name>
```

## O que NÃO é migrado automaticamente

- **Custom domain** / certificado SSL (se você tinha um). Reconfigure manualmente em ACA.
- **Application Insights** histórico (não tem, mas se adicionar, perde os dados antigos).
- **Imagens antigas no ACR antigo** — irrelevante, o `azd up` reconstrói tudo no ACR novo.
- **Backup automatizado do PG antigo** — se quiser preservar, baixe `.dump` antes do `99-cleanup-old.ps1`.

## Melhorias sugeridas (após migração estável)

Ver §5 da conversa de planejamento. Recomendações curtas:
1. Migrar Postgres para **Private Endpoint** (segurança)
2. Mover `ADMIN_SECRET` para **Key Vault** com `secretRef` no ACA
3. Adicionar **Application Insights** + alertas básicos
4. Adicionar workflow `deploy.yml` com OIDC (build + `azd deploy` no push)
5. Atualizar Node 18 → 20 LTS no Dockerfile da API
6. ACR lifecycle policy para purgar tags `azd-deploy-*` antigas
