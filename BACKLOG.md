# 📋 Backlog APEX

Guia vivo de melhorias e próximas fases do produto. Atualizar a cada nova entrega.

> Última atualização: 2026-05-22

---

## ✅ Já entregue

| Fase | Descrição | PRs |
|------|-----------|-----|
| 1 | Schema v8 — programas de treino | — |
| 2 | Importer idempotente das planilhas | — |
| 3 | APIs programas / sessões / coach | — |
| 4 | UI mínima do aluno | — |
| Pré-5 | Hotfix `ec.nome`, role+program_assignment, catálogo 9 programas, fusão Treinos+Programas, portal personal, cards do coach, escolha de programa, troca encerra anterior, sessão interativa, botão Voltar, métricas avançadas portal personal | #33-50 |
| 6 | Áudio em background + Wake Lock + TTS + persistência timer | #53 |
| 7 (parcial) | README + `docs/USAGE.md` + smoke tests | #54 |
| Auth | Entra ID JWT + migration v15 + portal super admin + signup personal | #59-62 |

---

## 🔥 Próximas fases — Alto valor / curto prazo

### Fase 8 — Housekeeping da migração de auth
- Linkar `entra_object_id` dos 5 users seed (Mariana/Rafael/Juliana/Bruno/Camila)
- Remover fallback `X-User-Id` (forçar Bearer JWT)
- Refresh token handling + tela de "sessão expirada"
- Audit log: paginação e filtros no admin portal

### Fase 9 — Chat aluno ↔ personal
- MVP polling em 1-2 dias OU real-time com Azure SignalR
- Notificação badge no portal do personal e no card do aluno
- Histórico de conversas persistido (tabela `app.message`)

### Fase 10 — Histórico detalhado de séries/cargas
- Migration `treinos.set_log(session_id, exercise_id, set_num, reps, carga_kg, rpe, completed_at)`
- UI: input por série dentro da sessão (substitui input genérico)
- Gráfico de PR (personal record) por exercício
- Personal vê evolução por aluno por exercício

### Fase 11 — Notificações Web Push
- VAPID keys via Azure Key Vault
- Service worker handle push event
- "Hoje é dia de Pernas (semana 3)" / "Novo programa atribuído" / "Personal aprovou cadastro"
- Toggle de notificações no perfil

### Fase 12 — Workflow genérico de solicitações/aprovações
- Aluno solicita troca de personal/programa → fila no portal do personal
- Personal solicita encerrar acompanhamento → vai para admin
- Tabela `app.request(type, requester_id, target_id, status, payload, decided_by, decided_at)`

### Fase 13 — Testes + CI/CD GitHub Actions
- Vitest para `src/api` (auth middleware, admin routes, programas)
- GitHub Action: tsc + vitest + smoke em cada PR
- Auto-deploy de `main` via `azd` action
- Branch protection na `main`

### Fase 14 — Observabilidade
- Application Insights no ACA (api + web)
- Distributed tracing
- Logs estruturados (pino)
- Dashboard Azure Monitor (latência, erros, RPS)
- Alerts (email/Teams) para 5xx ou queda de disponibilidade

### Fase 15 — Edição inline de programas pelo personal
- Editar templates semana a semana
- Drag-and-drop de exercícios
- Clonar programa do catálogo
- Versionamento (não quebra alunos em execução)

### Fase 16 — Onboarding inteligente do aluno
- Questionário inicial: objetivo, frequência, lesões, equipamento
- Algoritmo recomenda programa OU personals compatíveis
- Analytics de conclusão de onboarding

---

## 📈 Médio valor

### Fase 17 — Calendário & agenda
- Semana planejada vs realizada, drag para reagendar, export ICS

### Fase 18 — Dashboard do aluno
- Aderência mensal, streak, total minutos, PRs, comparativo com média

### Fase 19 — Filtros e busca no catálogo
- Nível, modalidade (musc/cross/corrida), duração, favoritos

### Fase 20 — Vídeos/GIFs dos exercícios
- Popular `exercise_media` (YouTube embed ou Azure Blob)
- Player inline na sessão

### Fase 21 — Substituição de exercício na sessão
- "Não tenho esse equipamento → sugerir alternativa"
- Catálogo de equivalências por grupo muscular

### Fase 22 — Comparativos no portal do personal
- Ranking de aderência
- Heatmap de risco
- Alunos em destaque (melhores PRs do mês)

---

## 🛠️ Técnico / qualidade

### Fase 23 — Rate limiting & WAF
- `express-rate-limit` nos endpoints públicos
- Azure Front Door + WAF

### Fase 24 — Segredos & rotação
- Tudo no Azure Key Vault
- Managed Identity do ACA com `references`
- Rotação automática

### Fase 25 — Backup & DR
- PG backup + retenção
- Runbook de restore
- Replicação cross-region opcional

### Fase 26 — Modo offline completo
- Service worker cacheia assets + última sessão
- Queue de POSTs para sync ao voltar online

### Fase 27 — Internacionalização
- Strings em JSON pt-BR/en-US
- Detector de idioma do navegador

### Fase 28 — Acessibilidade (WCAG AA)
- ARIA, contraste, navegação por teclado
- Lighthouse audit + correções

---

## 💎 Experiência & UX

### Fase 29 — Tema escuro polido + temas personalizados
- Auditar contraste em telas novas
- Personal escolhe cor primária do seu portal
- PWA installable banner

### Fase 30 — Notificações in-app (toast center)
- Histórico de notificações + "marcar como lidas"

### Fase 31 — Compartilhamento social
- PR/conquista no WhatsApp/Instagram (deep link)
- Imagem dinâmica gerada server-side

---

## 📊 Negócio / produto

### Fase 32 — Multi-personal (squad)
- Aluno pode ter Musc + Nutri + Corrida
- `coach_assignment.expertise`

### Fase 33 — Planos pagos / monetização
- Stripe checkout
- Personal cobra mensalidade dos alunos
- Dashboard financeiro (MRR, churn, novos alunos)
- Split de receita com a plataforma

### Fase 34 — Marketplace de programas
- Personals publicam programas autorais pagos
- Reviews e curadoria do admin

### Fase 35 — Mobile native (Capacitor / React Native)
- App store deploy
- Push nativo
- HealthKit / Google Fit

### Fase 36 — IA / Copilot do aluno
- Sugestão de carga baseada em histórico + RPE
- Detecção de plateau ("você está há 3 semanas no mesmo peso, hora de trocar?")
- Chat-bot tira-dúvidas treinado nos programas

---

## 🗺️ Ordem sugerida de execução

1. **Fase 8** — housekeeping auth (desbloqueia tudo)
2. **Fase 13** — CI/CD + testes (protege as próximas mudanças)
3. **Fase 9** — chat (fecha promessa "Em breve")
4. **Fase 10** — histórico de séries (destrava analytics reais)
5. **Fase 14** — observabilidade (antes de escalar usuários)
6. **Fase 11** + **Fase 12** — push notifications + workflow de aprovações
7. **Fase 16** — onboarding (melhora ativação)
8. Depois priorizar por contexto de negócio (33/34/35 se for monetizar; 18/19/20 se for crescer engajamento)

---

## 📐 Governança
- 1 PR por fase (ou sub-fase quando há paralelização possível)
- 1 issue no GitHub por fase, fechada via `Closes #NN` na PR
- Sub-fases independentes podem rodar em paralelo (fleet)
- Deploy via `azd deploy` após cada merge para `main`
- Smoke test (`npm run smoke` em `src/api`) após cada deploy
- Atualizar este BACKLOG.md sempre que uma fase for concluída ou um novo item for descoberto
