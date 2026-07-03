# ROADMAP.md

Roadmap evolutivo do Hermes. As fases devem ser implementadas em pequenas Pull Requests, com auditoria, testes e reversibilidade.

## Fase 1 — Fundação

Objetivo: transformar o MVP em base segura e governável.

Entregas:

- Separar código em camadas mínimas.
- Criar autenticação e identificação de usuário.
- Criar auditoria de conversas, tool calls e SQL.
- Criar usuário read-only no banco.
- Criar primeiros SQL Templates para perguntas frequentes.
- Criar catálogo de métricas v1.
- Criar testes básicos de API e templates.
- Versionar prompts.

Critério de saída:

- Nenhuma consulta crítica depende de SQL livre sem auditoria.
- Toda interação tem `trace_id` e registro mínimo.

## Fase 2 — Performance e custo (Hermes Intelligence Layer)

Objetivo: reduzir latência e custo antes de ampliar canais. Esta fase introduz a
**Hermes Intelligence Layer (HIL)**, cujo objetivo é **reduzir o uso de IA**:
responder primeiro pelos caminhos determinísticos e baratos, deixando o Claude
como última opção. Cascata: `response_library → semantic_cache → sql_template →
workflow → knowledge → claude`. Ver `docs/HERMES_INTELLIGENCE_LAYER.md`.

Entregas:

- **Fundação da HIL: classificador de intenção, interface da Response Library e decisão `shouldCallClaude` (sem integração).** ✅
- **HIL em modo observação no `/api/chat` (loga a decisão, sem rotear).** ✅
- **Fundação da camada de aprendizado: `question_statistics`, `recordQuestionStatistics` e agregadores (interfaces, sem cálculo).** ✅
- **Fundação do Semantic Cache: `buildSemanticKey`, `normalizeSemanticQuestion` e interfaces find/save (léxico, sem embeddings, sem integração).** ✅
- **HIL Shadow Mode: `simulateDecision` + log `hil_shadow_decision` (decide em paralelo, sem rotear).** ✅
- Response Library (respostas prontas para perguntas recorrentes).
- Cache exato para perguntas/templates.
- Cache semântico para perguntas recorrentes.
- Materialized views para KPIs principais.
- Rate limits por usuário/departamento.
- Controle de orçamento por modelo.
- Roteamento de modelos por complexidade.
- Dashboard de custos e latência.

Critério de saída:

- Perguntas recorrentes não chamam LLM nem banco desnecessariamente.

## Fase 3 — WhatsApp e Evolution API

Objetivo: adicionar canal operacional sem contaminar o core.

Entregas:

- Adaptador de canal WhatsApp.
- Integração Evolution API.
- Normalização de mensagens.
- Controle de sessão por telefone/usuário.
- Políticas para dados sensíveis via WhatsApp.
- Templates de resposta curta.
- Escalonamento para humano.

Critério de saída:

- WhatsApp usa os mesmos use cases, auditoria e políticas do Web.

## Fase 4 — Memória

Objetivo: adicionar memória útil sem criar acúmulo descontrolado de contexto.

Entregas:

- Memória de sessão persistente.
- Resumos de conversa.
- Memória de preferências do usuário.
- Proposta/revisão de memórias importantes.
- Expiração e classificação de sensibilidade.
- Busca de memória com contexto mínimo.

Critério de saída:

- O Hermes lembra preferências úteis, mas não grava tudo automaticamente.

## Fase 5 — Agentes especializados

Objetivo: criar especialistas por domínio com governança.

Entregas:

- Agente Diretoria.
- Agente Financeiro.
- Agente Estoque.
- Agente Compras.
- Agente Auditoria.
- Handoffs controlados.
- Guardrails por domínio.
- Avaliações por agente.

Critério de saída:

- Cada agente tem ferramentas, permissões e métricas próprias.

## Fase 6 — Base44

Objetivo: integrar aplicativos Base44 ao ecossistema Hermes.

Entregas:

- Contratos de integração por app.
- Registro de tools Base44.
- Autorização por app e ação.
- Eventos compartilhados.
- Catálogo de capacidades.
- Observabilidade por app.

Critério de saída:

- Apps Base44 conseguem consumir e expor capacidades sem acoplamento direto ao core.

## Fase 7 — IA Corporativa

Objetivo: consolidar Hermes como plataforma empresarial.

Entregas:

- Portal administrativo.
- Gestão de usuários, papéis e permissões.
- Gestão de prompts e SQL Templates.
- Gestão de conhecimento/RAG.
- Relatórios automáticos.
- Dashboards executivos.
- Políticas de compliance e auditoria.

Critério de saída:

- Diretoria e áreas operam Hermes como sistema corporativo, não experimento.

## Fase 8 — Aprendizado contínuo

Objetivo: melhorar qualidade com feedback e avaliações.

Entregas:

- Golden questions por domínio.
- Avaliações automáticas de respostas.
- Feedback do usuário.
- Curadoria de falhas.
- Experimentos A/B de prompts/templates.
- Relatórios de qualidade.

Critério de saída:

- Toda melhoria importante pode ser medida antes e depois.

## Fase 9 — Escalonamento empresarial

Objetivo: suportar alto volume, múltiplos canais e processos críticos.

Entregas:

- Event bus robusto.
- Filas e workers.
- Dead-letter queue.
- Circuit breakers.
- Multi-região se necessário.
- Read replicas/materializações avançadas.
- SLOs por canal.
- Plano de continuidade e incident response.

Critério de saída:

- Hermes suporta centenas de milhares de consultas com custo previsível e auditoria completa.
