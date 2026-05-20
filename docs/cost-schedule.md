# Otimização de custos — Schedule de Stop/Start

> Implementa #4 do backlog. Ambiente é **dev/single-user** (não-produção crítica), então pode ficar
> desligado fora do horário de uso. Economia estimada: ~60% do compute (12h/dia, 5/7 dias).

## Janela de operação

- **Ligado**: Segunda a Sexta, **08:00 → 20:00 (America/Sao_Paulo, UTC-3)**
- **Desligado**: Noites de Seg-Sex (20:00–08:00) e fins de semana (Sex 20:00 → Seg 08:00)

Em UTC:
- Stop:  cron `0 23 * * 1-5` (23:00 UTC = 20:00 BRT)
- Start: cron `0 11 * * 1-5` (11:00 UTC = 08:00 BRT)

> ⚠️ Se o Brasil voltar a adotar horário de verão, ajustar para UTC-2 (cron `0 22` e `0 10`).

## Recursos gerenciados

| Recurso | Tipo | Mecanismo |
|---|---|---|
| `psql-apex-ydcoajutfl3he` | Postgres Flexible | `az postgres flexible-server stop/start` |
| `ca-apex-api` | Container App | `min-replicas 0 / max-replicas 0` (efetivamente parado) |
| `ca-apex-web` | Container App | idem |

**Não são pausados** (custo idle insignificante ou não suportado):
- ACR (`acrapex...`) — storage de imagens, ~R$ 0,30/GB/mês
- Container Apps Environment — não suporta stop independente
- Log Analytics, Application Insights — billing por ingestão (já é $0 sem tráfego)

## Mecanismo

GitHub Actions com OIDC federado para Azure (sem secrets de senha):

- `.github/workflows/cost-schedule-stop.yml` — trigger cron + manual
- `.github/workflows/cost-schedule-start.yml` — trigger cron + manual + health check

Ambos rodam com a app registration `apex-github-oidc` (Contributor em `rg-apex-dev`).

### Secrets utilizados

| Secret | Origem |
|---|---|
| `AZURE_CLIENT_ID` | App registration `apex-github-oidc` (appId) |
| `AZURE_TENANT_ID` | Tenant da subscription |
| `AZURE_SUBSCRIPTION_ID` | Subscription Azure |

### Federated credential

```
issuer:    https://token.actions.githubusercontent.com
subject:   repo:fabiobo2005/miniature-octo-enigma:ref:refs/heads/main
audiences: api://AzureADTokenExchange
```

## Operação manual

### Ligar agora (fora do horário)

```bash
gh workflow run "Cost · Start (08:00 BRT, Mon-Fri)"
```

ou pela UI: **Actions → Cost · Start → Run workflow**.

### Desligar agora

```bash
gh workflow run "Cost · Stop (20:00 BRT, Mon-Fri)"
```

### Verificar estado

```bash
az postgres flexible-server show -g rg-apex-dev -n psql-apex-ydcoajutfl3he --query state -o tsv
az containerapp show -g rg-apex-dev -n ca-apex-api  --query "properties.template.scale" -o json
az containerapp show -g rg-apex-dev -n ca-apex-web  --query "properties.template.scale" -o json
```

## Troubleshooting

**App acordou às 08:00 mas retorna 502/timeout por alguns minutos**
Esperado: PG demora ~1-2min para sair de `Stopped`. O workflow start aguarda até 5min e faz health check.

**Esqueci de ligar e preciso usar agora**
Rode o workflow `Cost · Start` manualmente (acima) — leva ~3min para tudo subir.

**Quero pausar o agendamento por uns dias**
Vá em **Actions → Cost · Stop → ··· → Disable workflow** (e o mesmo para Start). Lembre de reativar.

**Failed: insufficient permissions**
Verificar role assignment:
```bash
az role assignment list --assignee 57c64d58-af1a-4201-8bd2-50fb40f29042 \
  --scope /subscriptions/204e10bc-fa25-44fa-84fb-18e5ffe403eb/resourceGroups/rg-apex-dev -o table
```

## Estimativa de economia

| Item | Antes (24/7) | Depois (60h/semana) | Economia |
|---|---|---|---|
| PG Flexible B1ms | ~R$ 75/mês | ~R$ 27/mês | -64% |
| ACA api+web (~vCPU idle) | ~R$ 40/mês | ~R$ 15/mês | -62% |
| **Total estimado** | **~R$ 115** | **~R$ 42** | **~R$ 73/mês** |

> Valores aproximados. Conferir no Azure Cost Management após 1 mês.
