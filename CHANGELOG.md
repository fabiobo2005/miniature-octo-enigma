# 📜 CHANGELOG · APEX

Histórico de mudanças significativas. Atualizar a cada deploy/feature relevante.
Formato: `## vX.Y · YYYY-MM-DD · título` — depois sub-seções (Backend / Frontend / DB / DevOps / Notas).

---

## v8.3.1 · 2026-05-20 · Hardening: guard typeof em chamadas globais (saude)

### Frontend
- Botões "🔔 Notificações" no header e na seção "Status & Notificações" de `saude.html`
  agora usam `if (typeof reqNotifPermission === 'function')` antes de chamar.
- Previne `ReferenceError` se o script ainda não tiver carregado.

### Notas
- Issue GitHub #5 fechada por este release.

---

## v8.3 · 2026-05-20 · Security: gate admin + CORS restrito

### Backend
- Adicionado `cors` middleware com whitelist via env `ALLOWED_ORIGINS` (CSV).
  Origem desconhecida → request bloqueado (sem `Access-Control-Allow-Origin`).
- `/api/db/inspect` protegido por header `X-Admin-Secret` (ou query `?key=`).
  Sem env `ADMIN_SECRET`: retorna 404 (rota efetivamente oculta).
  Com env mas sem header válido: 401.

### Frontend (nginx)
- `/db.html` agora retorna 404 a menos que `X-Admin-Secret` corresponda à env `ADMIN_SECRET`.
- `entrypoint.sh` gera mapa nginx `$admin_unlock` em tempo de boot.

### Notas
- Issues GitHub #1 e #2 fechadas por este release.
- Env vars `ADMIN_SECRET` setada nos 2 ACAs; `ALLOWED_ORIGINS` no API.

---

## v8.2 · 2026-05-20 · DevOps: schedule de stop/start para otimização de custo

### DevOps
- Adicionado fluxo branch+PR (CONTRIBUTING.md, branch protection em `main`).
- App registration `apex-github-oidc` com federated credential para GitHub Actions
  (sem segredos de senha). Role: Contributor em `rg-apex-dev`.
- Workflow `cost-schedule-stop.yml` (cron `0 23 * * 1-5` UTC = 20:00 BRT seg-sex):
  - Para `psql-apex-ydcoajutfl3he`
  - Escala `ca-apex-api` e `ca-apex-web` para 0/0 réplicas
- Workflow `cost-schedule-start.yml` (cron `0 11 * * 1-5` UTC = 08:00 BRT seg-sex):
  - Inicia o Postgres e aguarda estado `Ready`
  - Restaura ACAs para 1/3 réplicas
  - Health check em `/healthz`
- Documentação em `docs/cost-schedule.md` (runbook + estimativa de economia ~R$ 73/mês).

### Notas
- Issue GitHub #4 (P0 backlog) endereçada por este release.
- Refs: PR `feat/cost-schedule-pg-aca`.

---

## v8.1 · 2026-05-20 · Hotfix: troca de usuário ficava em branco ✅ validado em produção

### Causa raiz
- `service-worker.js` antigo (`apex-v3`) ainda residente no navegador servia bundles
  v7 do cache (`/index.html`, `/js/core.js`, `/js/launcher.js`) mesmo após deploy v8.
- Ao clicar "Trocar usuário", o reload pegava índice v7 que não sabia interpretar o
  novo fluxo de picker → `viewPicker` ficava com atributo `hidden` → tela branca.

### Fixes
- **`service-worker.js` → v8**: cache name `apex-v8`, estratégia **network-first para
  HTML/JS** (com fallback ao cache se offline) e cache-first para CSS/manifest/ícones.
  Listener `message` aceita `clearCache` (postMessage) e `skipWaiting`.
- **`core.js → logoutUser()`** agora é async: limpa `notifFired`/`_notifTimer` (vazamento
  entre perfis — P0#3 do backlog), envia `clearCache` ao SW, deleta todos os caches via
  Cache API, e faz `location.replace('/')` (evita botão "voltar" reabrir sessão antiga).
- **`launcher.js → initHome`** envolvido em try/catch global com fallback que sempre
  garante exibição do picker — mesmo se algo falhar, o usuário vê uma mensagem de erro
  no grid em vez de página em branco.

### P0 resolvidos do backlog
- ✅ P0#2 — SW cache servindo v7 obsoleto
- ✅ P0#3 — `notifFired` vazando entre usuários após troca

---

## v8.0 · 2026-05-20 · Multiusuário (sem auth)

Refatoração para suportar múltiplos perfis na mesma instância. Preparada para auth futura
(basta plugar provedor: hoje a seleção de usuário fica em `localStorage` e o `user_id` é
injetado automaticamente em todas as chamadas de API pelo helper `api()` do `core.js`).

### Database (PostgreSQL)
- **Migration `v3-multiuser`** (registrada em `app.schema_migrations`, idempotente):
  drop das tabelas single-user antigas (saude.evolution, saude.supplement, saude.supplement_log,
  dieta.meal_log, treinos.workout_log) — **dados anteriores foram apagados a pedido**.
- Novo schema `app` (transversal): `app.user` (UUID, name, email, avatar_url, birth_date,
  height_cm, goal, active) + `app.schema_migrations`.
- Todas tabelas de domínio passaram a ter `user_id UUID NOT NULL REFERENCES app.user(id) ON DELETE CASCADE`:
  - `saude.evolution` (PK composta: user_id + measured_on)
  - `saude.supplement` (FK)
  - `saude.supplement_log` (FK)
  - `dieta.meal_log` (PK composta: user_id + logged_on + meal_id)
  - `treinos.workout_log` (FK)
- Nova tabela `dieta.profile` (kcal_target, meals_per_day, plan_source, started_on) — opcional.
- Índices reotimizados por `(user_id, data DESC)`.

### API (Node/Express/TS)
- **Router novo:** `/api/users` (GET list, POST, GET/:id, PUT/:id, DELETE/:id soft).
- **Endpoint novo:** `GET /api/users/:id/status` → `{ user, saude:{has_data,...}, dieta:{has_data,...}, treinos:{has_data,...} }`.
  Usado pelo frontend para decidir se exibe o overlay obrigatório de cadastro inicial.
- Todas as rotas `/api/saude/*`, `/api/dieta/*`, `/api/treinos/*` agora **exigem `user_id`**
  (via query, body ou header `X-User-Id`). Sem ele → `400 user_id required`.
- Validação de ownership em UPDATE/DELETE (`WHERE user_id=$X`) — usuário não consegue editar
  recurso de outro perfil.
- Aliases legados `/api/evol`, `/api/meals` etc. **removidos** (incompatíveis com novo schema).
- Health agora retorna `version: '3.0.0'`.

### Frontend
- **`index.html` reescrito**: agora tem dois estados:
  - `viewPicker` — lista de perfis (cards) + botão "Novo perfil" abrindo modal com nome
    (obrigatório), e-mail, nascimento, altura, objetivo.
  - `viewHub` — os 3 cards de área (Saúde/Dieta/Treinos), só visíveis após escolha de perfil.
- **`core.js`**:
  - Novo objeto `USER` com `get/set/id/clear/require()` (persistência em `localStorage`,
    chave `apex.user`).
  - `api()` agora **injeta `user_id` automaticamente** (query em GET/DELETE, body em POST/PUT,
    e header `X-User-Id` sempre). Função `apiRaw()` mantida para chamadas sem contexto de usuário.
  - Novo helper `showRequiredOverlay({title, html, onSubmit})` — modal cheio que trava
    a página até o primeiro registro ser feito.
  - Botão "Trocar usuário" no topbar de todas as páginas → `logoutUser()` volta para `/`.
- **`saude.html` / `dieta.html` / `treinos.html`**: topbar mostra `#userChip` (nome do
  perfil ativo) + botão trocar usuário; no `DOMContentLoaded` chamam `USER.require()` e em
  seguida `check{Area}Req()` que consulta `/api/users/:id/status` e exibe overlay obrigatório
  caso não exista nenhum dado para aquela área.
- Overlays obrigatórios por área:
  - **Saúde:** data (auto-hoje) + peso (obrigatório); BF/MM opcionais.
  - **Dieta:** refeição + status (done/partial/skipped) para o dia.
  - **Treinos:** data + nome + duração (todos obrigatórios) + categoria/intensidade opcionais.
- Removido seeding automático de 12 suplementos default (não fazia sentido cross-user).

### DevOps
- Schema é auto-aplicado pela API no startup (`ensureSchema`). Migration `v3-multiuser`
  só roda **uma vez** (controle via `app.schema_migrations`).
- Deploy: `azd deploy` (api + web). RG: `rg-apex-dev` (Central US). FQDN PG:
  `psql-apex-ydcoajutfl3he.postgres.database.azure.com`.

### Como retomar do zero (status para próxima sessão)
1. URL: https://ca-apex-web.jollyglacier-b0e801ab.centralus.azurecontainerapps.io/
2. DB **zerada** (sem perfis, sem dados). Primeira ação na UI: clicar em "Novo perfil".
3. Após criar perfil, é redirecionado ao hub. Cada área pede dados iniciais via overlay.
4. `azd env get-values` em `apex-cloud/` mostra todas as vars de ambiente.
5. Próximas P0 do backlog: ver `backlog.md`.

### Arquivos `*.v7.bak` deixados para referência
- `src/api/db/init.sql.v7.bak`
- `src/api/src/routes/{saude,dieta,treinos}.ts.v7.bak`
- `src/web/index.html.v7.bak`
- `src/web/js/{core,launcher}.js.v7.bak`

---

## v7.0 · 2026-05-14 · Separação em 3 áreas + cards

- Migração de `guia.html` single-file para SPA estática com 3 páginas independentes
  (`saude.html`, `dieta.html`, `treinos.html`) servidas por NGINX em Azure Container Apps.
- Schemas Postgres separados (`saude`, `dieta`, `treinos`) — preparação para futura
  desacoplagem em microserviços/databases.
- API consolidada (Node/Express) com routers por área + `/api/db/inspect` (debug).
- Hub central (`index.html`) com cards de status agregando KPIs das 3 áreas.

## v6.0 · 2026-05-13 · Single-file HTML → migrado para cloud

- Snapshot final do `guia.html` v6 (localStorage) migrado para `apex-cloud/src/web`.
- Subida inicial em Azure Container Apps (web) + Postgres Flexible Server (B1ms, Entra-only).
- CI/CD via `azd pipeline config` (OIDC, sem secrets).
