# Contribuindo com APEX

> Repositório: `fabiobo2005/miniature-octo-enigma` · Branch principal: `main`

## Fluxo de trabalho

Todo trabalho passa por **branch + PR**. Push direto em `main` está bloqueado.

```bash
# 1. Sincronizar
git checkout main && git pull

# 2. Criar branch a partir de main
git checkout -b feat/nome-curto

# 3. Codar, testar localmente, fazer deploy de validação se necessário
azd deploy [api|web|--all] --no-prompt

# 4. Commitar (Conventional Commits)
git commit -m "feat: descrição curta no imperativo"

# 5. Subir e abrir PR
git push -u origin feat/nome-curto
gh pr create --base main --fill --body "Closes #<issue>"
```

## Stagings Dev / Prod (ACA revision labels)

Os Container Apps rodam em `activeRevisionsMode: Multiple` com dois labels:

| Slot   | URL                                                                                              | Tráfego |
|--------|--------------------------------------------------------------------------------------------------|---------|
| `prod` | `https://ca-apex-web.jollyglacier-b0e801ab.centralus.azurecontainerapps.io/`                     | 100% |
| `dev`  | `https://ca-apex-web--<revision-suffix>.jollyglacier-b0e801ab.centralus.azurecontainerapps.io/`  | 0% — acesso direto |

> **Nota:** a URL fixa `ca-apex-web--dev.<domain>` (labeled FQDN) é retornada 404 pelo
> ingress do ACA neste env, então usamos a URL **per-revision** (gerada com sufixo
> `dev-<sha>` a cada deploy). O workflow `deploy-dev.yml` imprime a URL no Summary.

Limitação aceita: **Postgres é compartilhado entre dev e prod**. Migrations devem ser
backward-compatible (expand → migrate → contract). Web em dev chama API em prod
por padrão (FQDN sem label). Para testar full-stack, promova a API primeiro.

### Fluxo de release

1. **PR mergeado em `main`** → workflow [`Deploy · Dev`](.github/workflows/deploy-dev.yml)
   dispara automaticamente:
   - Build de imagens via ACR (`apex-api:dev-<sha>`, `apex-web:dev-<sha>`)
   - Cria nova revisão em cada ACA com sufixo `dev-<sha>`
   - Move label `dev` para a nova revisão (rev antiga perde o label)
   - Tráfego público continua **100% prod**
2. **Validar manualmente** na URL `--dev` (UI, API via `/api/health`, etc).
3. **Promover**: rode [`Promote · Prod`](.github/workflows/promote-prod.yml)
   (`workflow_dispatch`, input `confirm=PROMOTE`).
   - Pausa em **required reviewer** (`production` environment) — aprovação obrigatória do dono.
   - Swap atômico: labels `dev` ↔ `prod` em ambos os apps, tráfego 100% → novo `prod`.
   - A revisão antiga continua acessível na URL `--dev` para rollback rápido.
4. **Rollback**: rode `Promote · Prod` novamente — swap volta.

### Quando precisar pular o staging

Para hotfix urgente direto em prod (não recomendado): `azd deploy` local. Isso cria
uma nova revisão `azd-*` que vira **a nova prod** automaticamente porque o Bicep
mantém `latestRevision: true` no traffic config. Use só em emergência e documente
no CHANGELOG.

## Convenções de branch

| Prefixo    | Uso                                              |
|------------|--------------------------------------------------|
| `feat/`    | Nova funcionalidade                              |
| `fix/`     | Correção de bug                                  |
| `chore/`   | Manutenção (deps, config, build, refactor leve)  |
| `docs/`    | Apenas documentação                              |
| `refactor/`| Refactor sem mudar comportamento                 |
| `test/`    | Adicionar/ajustar testes                         |

Nome curto, kebab-case, sem ticket no nome (o link vai no PR via `Closes #N`).

## Conventional Commits

Tipo principal no imperativo, sem ponto final:

```
feat: gate /db.html atrás de header secreto
fix: limpar notifFired ao trocar usuário
chore: bumpar nginx para 1.27-alpine
docs: registrar v8.1 no CHANGELOG
```

## Pull Requests

- **Título:** mesmo padrão do conventional commit
- **Body:** sempre incluir `Closes #<issue>` quando aplicável
- **Checklist mínimo no PR:**
  - [ ] CHANGELOG.md atualizado (se mudança visível ao usuário ou ao operador)
  - [ ] backlog.md atualizado (item movido de P0/P1/P2 para concluído)
  - [ ] Deploy de validação executado (`azd deploy ...`) — colar output curto
  - [ ] Smoke test descrito no body do PR
- **Merge:** preferir **squash** para manter histórico de `main` linear e legível

## Versionamento

Bump no `CHANGELOG.md` segue **MAJOR.MINOR**:
- **MAJOR**: breaking change de schema/contrato (ex: v8 multiusuário)
- **MINOR**: feature ou hotfix (ex: v8.1)

Cada deploy em produção deve ter uma entrada datada (`YYYY-MM-DD`) no CHANGELOG.

## Issues

Usar labels: `P0`, `P1`, `P2`, `bug`, `feature`, `security`, `infra`, `frontend`, `backend`.

PRs sem issue associada são aceitos para `chore/` e `docs/` triviais.
