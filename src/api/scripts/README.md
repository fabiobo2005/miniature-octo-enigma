# Importer de Programas de Treino

CLI idempotente que lê as planilhas Excel de programas de treino e popula
o schema `treinos` no PostgreSQL.

## Uso

Pré-requisitos: schema v8 aplicado (auto via start da API).

```bash
# Importa todos os .xlsx de um diretório (padrão = raiz do repo pai)
npm run import:treinos -- --dir C:\Trainner\nutri

# Apenas um arquivo
npm run import:treinos -- --file ./Maio2026.xlsx

# Apenas valida o parsing, sem gravar
npm run import:treinos -- --dry-run

# Reimporta mesmo se já houver import_run com status=success para o mesmo sha256
npm run import:treinos -- --force

# Não carrega scripts/aliases.json (apenas usa o catálogo já presente)
npm run import:treinos -- --no-seed

# Sobrescreve a classificação automática para TODOS os arquivos do run
npm run import:treinos -- --file ./Maio2026.xlsx --nivel avancado
```

## Nomes e classificação de programas

A classificação (`nivel`) é **obrigatória** — a coluna `treinos.program.nivel`
é `NOT NULL` (migração `v8.1-program-nivel-not-null`). O importer aplica uma
heurística automática baseada em **métodos avançados** (drop-set, ondulatório,
excêntrico, bi-set, tri-set, ponto zero, série de saída, reconhecimento,
exaustão, rest-pause, TUT, repetições forçadas) e **exercícios complexos**
(Levantamento Terra, Agachamento Hack/Pêndulo/Livre, Flexão Nórdica, Barra
Fixa, Stiff, Paralelas). Score:

- `>= 8` → **avancado**
- `>= 4` → **intermediario**
- `<  4` → **iniciante**

Use `--nivel iniciante|intermediario|avancado` para forçar a classificação.

Os programas são **renomeados** para o padrão:

```
Programa <Categoria> <Romano>
  ex.: Programa Iniciante I
       Programa Intermediário II
       Programa Avançado III
```

A numeração romana é atribuída por categoria, considerando programas já
existentes no banco (idempotência preservada via lookup por `source_sha256`:
reimportar o mesmo arquivo mantém o id e o romano originais).

## Variáveis de ambiente para conexão ao banco

Em ordem de prioridade:
1. `DATABASE_URL` (connection string completa)
2. `PG_PASSWORD` + (`PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`)
3. Token AAD via `DefaultAzureCredential` (mesmo fluxo da API em produção)

`PG_SSL=true` força SSL para Postgres gerenciado.

## Idempotência

- `treinos.import_run` registra cada execução com o `source_sha256` do arquivo.
  Quando `status='success'`, esse hash fica único — uma segunda execução é
  reportada como `skipped`. Use `--force` para reimportar.
- `treinos.program` é localizado primeiro por `source_sha256` (preserva id) e
  depois por `nome` (UPSERT). Reimportar o mesmo arquivo atualiza
  `nivel`, `duracao_semanas`, `source_file` e `source_sha256`.
- `treinos.workout_template` tem UNIQUE em
  `(program_id, semana_numero, cor, nome_treino)`.
- As prescrições do template são **substituídas** a cada reimportação
  (`DELETE ... WHERE workout_template_id = $1` antes do INSERT), garantindo
  estado consistente sem duplicar.

## Aliases

`src/api/scripts/aliases.json` semeia o catálogo de exercícios com nomes
canônicos e variações conhecidas. Quando o importer encontra um nome novo,
ele cria automaticamente uma entrada em `exercise_catalog` e um alias
correspondente em `exercise_alias` (origem `importer`), preservando o nome
original também no `exercise_prescription.nome_original` e em `raw_row`.
