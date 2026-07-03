# HERMES_AUDIT.md

Auditoria inicial do repositório `agente-grupo-erick`, tratado como a fundação do Hermes: plataforma de IA operacional corporativa do Grupo Erick.

> Data da auditoria: 02/07/2026.
> Escopo: análise estática do repositório local, sem acesso real às credenciais de Railway, Supabase, Metabase ou Anthropic.

## 1. Resumo executivo

O projeto atual é um MVP funcional de chat analítico: uma aplicação Node.js/Express serve uma interface web simples e encaminha conversas para Claude com uma ferramenta de SQL direto no Supabase PostgreSQL.

Esse MVP comprova valor rápido porque já conecta linguagem natural a dados operacionais históricos. Porém, ele ainda não é uma plataforma corporativa de IA. A arquitetura atual centraliza prompt, regras de negócio, acesso ao banco, execução de SQL, streaming, UI e lógica de agente em poucos arquivos. Para suportar Diretoria, Financeiro, Compras, RH, Marketing, Estoque, Auditoria, Vendas, Clientes, Fornecedores, WhatsApp, n8n, Evolution API, Base44, memória, skills, auditoria e alto volume, o projeto precisa evoluir para uma arquitetura modular, segura, observável, orientada a eventos e governada por domínio.

## 2. Inventário atual do projeto

### 2.1 Estrutura

```text
.
├── README.md
├── package.json
├── package-lock.json
├── server.js
├── public/
│   └── index.html
├── .env.example
└── .gitignore
```

### 2.2 Stack detectada

- Backend: Node.js com Express.
- Banco: PostgreSQL via `pg`, com connection string Supabase.
- IA: Anthropic Claude via HTTP nativo (`https.request`).
- Frontend: HTML/CSS/JavaScript puro.
- Deploy esperado: Railway via `npm start`.
- Streaming: endpoint `/api/chat` responde com Server-Sent Events.
- Configuração: variáveis `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PORT`.

### 2.3 Fluxo atual

1. Usuário envia mensagem na interface web.
2. Frontend acumula histórico em memória do navegador.
3. Backend recebe `messages` em `/api/chat`.
4. Backend envia prompt completo e histórico para Claude.
5. Claude pode chamar a ferramenta `query_database`.
6. Backend executa SQL no Supabase sem camada intermediária de templates, allowlist ou políticas por usuário.
7. Resultado volta para Claude.
8. Claude produz resposta final.
9. Frontend renderiza resposta com markdown simples.

### 2.4 Banco e dados conhecidos pelo código

O prompt informa a existência das views `public.vw_faturamento_mensal`, `public.vw_itens_vendidos`, `public.vw_contas_a_receber`, `public.vw_inadimplencia_por_faixa`, `public.vw_produtos_catalogo` e tabelas brutas em `softcom_import`, incluindo vendas, itens, contas a receber, compras, mercadorias, clientes mascarados, bloquetes e movimentações financeiras.

A aplicação não possui migrations, modelos, contratos de schema, testes de queries, camada de repositório ou catálogo versionado de SQL.

## 3. Pontos fortes

| Prioridade | Ponto | Impacto |
|---|---|---|
| P1 | MVP simples e funcional | Permite provar valor rapidamente com baixo atrito operacional. |
| P1 | Uso de views analíticas | Reduz complexidade de SQL bruto e facilita respostas gerenciais. |
| P1 | Streaming para o usuário | Melhora percepção de velocidade em consultas longas. |
| P1 | Health check `/health` | Facilita monitoramento básico no Railway. |
| P2 | README com instruções de deploy | Ajuda continuidade operacional. |
| P2 | Prompt contém contexto de negócio | A IA responde com linguagem aderente ao Grupo Erick. |
| P2 | Uso de pool PostgreSQL | Melhor que conexão única por request. |

## 4. Pontos fracos e riscos

### P0 — Críticos

| Item | Descrição | Risco | Recomendação |
|---|---|---|---|
| SQL livre gerado por LLM | A ferramenta executa qualquer SQL recebido do modelo. | Vazamento, alteração acidental, custo alto, locks, full scans, prompt injection. | Substituir por SQL Templates versionados, allowlist, validação AST, usuário read-only, limites de linhas/tempo e políticas por papel. |
| Ausência de autenticação/autorização | O endpoint `/api/chat` não identifica usuário, departamento, papel ou loja. | Dados sensíveis podem ser expostos a usuários indevidos. | Implementar auth, RBAC/ABAC, escopos por departamento e trilha de auditoria. |
| Sem auditoria persistente | Não há registro estruturado de prompts, SQL, respostas, custos, erros e usuários. | Impossível investigar decisões, custos, incidentes ou vazamentos. | Criar `agent_runs`, `tool_calls`, `sql_executions`, `audit_events`. |
| Prompt monolítico com regras críticas | Regras de negócio, metadados e segurança estão dentro do prompt. | Difícil versionar, testar, governar e auditar. | Separar contratos de domínio, catálogo semântico, templates, políticas e prompts versionados. |
| Sem proteção contra prompt injection | Usuário pode tentar instruir o modelo a ignorar regras ou consultar tabelas sensíveis. | Exfiltração ou consultas indevidas. | Guardrails antes e depois do modelo, classificação de intenção e política de ferramentas. |

### P1 — Alta prioridade

| Item | Descrição | Risco | Recomendação |
|---|---|---|---|
| Arquitetura monolítica em `server.js` | API, agente, prompt, tool e banco estão acoplados. | Crescimento lento, alto risco de regressão. | Migrar gradualmente para módulos: API, application, domain, infrastructure, agents. |
| Sem cache | Perguntas frequentes sempre chamam LLM e banco. | Custo e latência desnecessários. | Cache semântico + cache de SQL template + cache por dashboard/período. |
| Sem observabilidade LLM | Não há traces, métricas de tokens, latência, acurácia ou custo. | Operação cega. | OpenTelemetry + traces de agente + métricas por modelo/ferramenta/departamento. |
| Sem controle de custo | `max_tokens` fixo e histórico crescente sem orçamento por usuário. | Custos imprevisíveis. | Budgets, rate limits, roteamento de modelos, compressão de contexto. |
| Histórico no navegador | Memória de conversa só existe no cliente e é reenviada inteira. | Contexto cresce, custo sobe, perda de histórico auditável. | Sessões persistentes, memória curta resumida e memória longa governada. |
| Sem testes | Não há testes unitários, integração ou contratos de SQL. | Mudanças futuras quebram comportamento sem aviso. | Criar testes de templates, API, renderização e políticas. |

### P2 — Média prioridade

| Item | Descrição | Risco | Recomendação |
|---|---|---|---|
| Frontend sem framework/estrutura | Interface é útil, mas tudo está em um HTML. | Dificulta evolução para áreas, permissões, uploads, relatórios. | Modularizar ou migrar para app web estruturado quando necessário. |
| Renderização markdown manual | Parser simples pode gerar inconsistências. | UX quebrada em respostas complexas. | Usar biblioteca sanitizada ou componente controlado. |
| Sem versionamento de prompts | Mudanças em prompt não são rastreadas como artefatos executáveis. | Regressões de comportamento. | `prompts/` versionado + avaliações. |
| Sem catálogo de domínio | Conhecimento do negócio está espalhado no prompt. | Ambiguidade e duplicação. | Criar ubiquitous language e bounded contexts. |
| Sem integração com Metabase | Metabase existe no ecossistema, mas não aparece no código. | Duplicação de métricas entre IA e BI. | Usar Metabase como fonte de dashboards/consultas oficiais ou catálogo de métricas. |

### P3 — Evolutivo

| Item | Descrição | Oportunidade |
|---|---|---|
| Multiagentes inexistente | Ainda há um único agente genérico. | Criar agentes especialistas por domínio quando a base estiver segura. |
| Sem MCP | Integrações futuras podem virar acoplamento direto. | Expor Supabase, Metabase, n8n, Base44 e WhatsApp como ferramentas padronizadas. |
| Sem event bus | Workflows são síncronos. | Evoluir para eventos: relatório gerado, alerta de inadimplência, escalonamento. |
| Sem aprendizado contínuo | Não há feedback do usuário nem avaliação. | Criar ciclo de avaliação, curadoria e melhoria de templates/memórias. |

## 5. Gargalos prováveis

1. **Latência LLM + SQL**: cada pergunta pode exigir uma ou mais chamadas ao modelo e uma query potencialmente pesada.
2. **Pool de conexões**: configuração simples pode saturar sob muitos usuários sem PgBouncer/Supabase pooler bem dimensionado.
3. **Queries não otimizadas**: SQL livre pode gerar varreduras completas em tabelas grandes.
4. **Contexto crescente**: histórico inteiro aumenta tokens e custo progressivamente.
5. **Resposta síncrona**: relatórios longos e automações deveriam ir para fila/background job.
6. **Ausência de cache**: perguntas repetidas de diretoria e loja recalculam tudo.

## 6. Oportunidades imediatas

### P0/P1 — Quick wins arquiteturais

- Criar usuário PostgreSQL read-only específico para IA.
- Bloquear comandos não-SELECT e acesso direto a schemas sensíveis.
- Criar SQL Templates para perguntas frequentes já presentes na tela inicial.
- Logar toda execução de SQL com `request_id`, usuário, template, parâmetros, duração, linhas e erro.
- Definir budgets por dia/usuário/departamento.
- Criar catálogo de métricas oficiais: faturamento, ticket médio, inadimplência, ranking de vendedores, produtos.

### P2/P3 — Estratégicas

- Separar motor de agente do canal web.
- Criar event bus para relatórios, alertas, escalonamentos e automações.
- Introduzir memória em camadas: sessão, usuário, departamento, empresa.
- Introduzir MCP como fronteira de integração.
- Criar avaliação contínua com golden questions e comparação de respostas.

## 7. Referências conceituais usadas

- LangGraph Persistence: memória curta por checkpointers e memória longa por stores, útil para retomada e continuidade de agentes: https://docs.langchain.com/oss/python/langgraph/persistence
- LangChain/LangGraph Human-in-the-loop: interrupção e aprovação humana para ações sensíveis como execução de ferramentas: https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- OpenAI Agents SDK: agentes com ferramentas, handoffs, guardrails, tracing e avaliação de workflows: https://openai.github.io/openai-agents-python/
- MCP: padrão aberto para conectar aplicações de IA a ferramentas, recursos e prompts externos: https://modelcontextprotocol.io/specification/2025-06-18
- Anthropic MCP announcement: visão de conexões seguras entre dados/ferramentas e aplicações de IA: https://www.anthropic.com/news/model-context-protocol
- Mem0: camada de memória persistente para agentes: https://github.com/mem0ai/mem0
