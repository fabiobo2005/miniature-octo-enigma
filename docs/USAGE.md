# Guia de Uso · APEX Cloud

Este guia descreve os fluxos principais para as duas personas do produto: **Aluno** e **Personal**.

## Personas

### Aluno

Pessoa acompanhada no app. Usa as áreas de Saúde, Dieta e Treinos para registrar evolução, aderência alimentar e execução dos treinos prescritos.

### Personal

Profissional responsável por acompanhar alunos, revisar métricas, atribuir programas e monitorar aderência e inatividade pelo portal do personal.

## Fluxo do Aluno

1. **Login / seleção de usuário**
   - O aluno entra no app e identifica seu perfil ativo.
   - A navegação principal apresenta as três áreas: Saúde, Dieta e Treinos.

2. **Tela Treinos**
   - A área Treinos mostra o estado atual do aluno e o próximo passo recomendado.
   - Existem três estados principais:
     - **Com programa ativo:** mostra programa, semana atual, próximo treino e ações para iniciar sessão.
     - **Programa concluído:** informa conclusão e orienta escolher/receber novo programa.
     - **Sem personal/programa:** apresenta descoberta de personals e opção de solicitar acompanhamento.

3. **Iniciar sessão**
   - O aluno inicia o treino sugerido ou um template do programa.
   - A sessão registra exercícios, séries, repetições, carga, RPE/PSE e observações.

4. **Cronômetro e beep**
   - Durante a sessão, o aluno usa cronômetro/intervalos.
   - Os beeps indicam início/fim de intervalos e ajudam a manter ritmo de execução.

5. **Concluir treino**
   - Ao finalizar, a sessão é marcada como concluída.
   - O histórico passa a alimentar aderência, duração média, carga total e visão do personal.

## Fluxo do Personal

1. **Login / portal**
   - O personal entra com perfil de `personal` e acessa o portal dedicado.

2. **Dashboard**
   - O dashboard consolida a carteira de alunos com métricas como:
     - **Aderência:** sessões realizadas em janelas recentes.
     - **Duração:** tempo médio/total das sessões concluídas.
     - **Inativos:** alunos sem sessão recente ou com baixa frequência.

3. **Drill-down do aluno**
   - O personal abre o detalhe de um aluno para ver programa atual, semana, últimas sessões, observações e próximos treinos.

4. **Atribuir ou criar programa**
   - O personal seleciona um programa do catálogo ou cria/adapta uma prescrição.
   - A atribuição registra origem `coach`, início, status e vínculo com aluno/personal.

5. **CSV**
   - O portal permite exportar dados operacionais para acompanhamento externo, auditoria simples ou análise em planilhas.

## Catálogo de programas

O catálogo esperado em produção contém **15 programas**: 3 iniciantes, 5 intermediários e 7 avançados.

| Nível | Programa | Duração |
| --- | --- | --- |
| Iniciante | Programa Iniciante I | 4 semanas |
| Iniciante | Programa Iniciante II | 4 semanas |
| Iniciante | Programa Iniciante III | 4 semanas |
| Intermediário | Programa Intermediário I | 6 semanas |
| Intermediário | Programa Intermediário II | 6 semanas |
| Intermediário | Programa Intermediário III | 6 semanas |
| Intermediário | Programa Intermediário IV | 6 semanas |
| Intermediário | Programa Intermediário V | 6 semanas |
| Avançado | Programa Avançado I | 10 semanas |
| Avançado | Programa Avançado II | 8 semanas |
| Avançado | Programa Avançado III | 12 semanas |
| Avançado | Programa Avançado IV | 8 semanas |
| Avançado | Programa Avançado V | 8 semanas |
| Avançado | Programa Avançado VI | 10 semanas |
| Avançado | Programa Avançado VII | 12 semanas |

## Migrations aplicadas

As migrations são idempotentes e registradas em `app.schema_migrations` quando aplicável.

- **v3-multiuser:** migração multiusuário, criação de `app.user`, schemas por área e remoção de tabelas legadas single-user.
- **v8-programas-treino:** catálogo de exercícios/programas, templates, prescrições, sessões, execuções, timer, áudio, coach e auditoria de importação.
- **v8.1-program-nivel-not-null:** torna `treinos.program.nivel` obrigatório e normaliza registros legados.
- **v9-role-and-program-assignment:** adiciona `app.user.role` (`aluno`/`personal`) e cria `treinos.program_assignment`.
- **v10-program-assignment-source:** adiciona/normaliza `source` da atribuição (`self`/`coach`) e estados de encerramento.
- **v14-subfase-h-program-assignment-source:** alinha constraints de `program_assignment` com a Sub-fase H, incluindo encerramento por coach e origem.
