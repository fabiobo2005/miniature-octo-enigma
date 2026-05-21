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
```

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
- `treinos.program.nome` é único; reimportar atualiza `duracao_semanas`,
  `source_file` e `source_sha256`.
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
