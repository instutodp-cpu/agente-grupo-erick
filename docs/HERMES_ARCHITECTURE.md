# HERMES_ARCHITECTURE.md

Arquitetura alvo para o Hermes, a plataforma de IA operacional corporativa do Grupo Erick.

## 1. Visão

Hermes não deve ser tratado como chatbot. Hermes deve ser uma camada operacional de inteligência, automação e governança sobre os dados, processos e sistemas do Grupo Erick.

A plataforma deve permitir que usuários internos e externos façam perguntas, recebam relatórios, acionem workflows, consultem conhecimento, executem skills autorizadas, escalem decisões e auditem tudo que foi feito.

## 2. Princípio arquitetural central

> IA é uma camada de orquestração e raciocínio, não a fonte da verdade.

A fonte da verdade deve estar em bancos, sistemas de domínio, métricas oficiais, SQL Templates, eventos, documentos curados e políticas versionadas. O modelo deve decidir quando usar ferramentas, interpretar resultados e comunicar bem, mas não deve inventar regras de negócio nem executar ações críticas sem controle.

## 3. Arquitetura em camadas

```text
Canais
  Web | WhatsApp | Base44 Apps | Metabase | API externa | n8n

API Gateway / BFF
  Autenticação | Autorização | Rate limit | Tenant/loja/departamento | SSE/WebSocket

Orquestração de IA
  Router de intenção | Policy engine | Agent runtime | Tool registry | Human-in-the-loop

Domínio
  Vendas | Financeiro | Compras | Estoque | RH | Marketing | Auditoria | Clientes | Fornecedores

Aplicação
  Use cases | SQL Templates | Relatórios | Alertas | Escalonamentos | Jobs

Infraestrutura
  Supabase/Postgres | Metabase | Evolution API | n8n | Base44 | Cache | Vector DB | Object Storage

Plataforma
  Event bus | Observabilidade | Auditoria | Custos | Versionamento | Avaliações | Segurança
```

## 4. Componentes principais

### 4.1 API Gateway / BFF

Responsável por receber tráfego de canais e aplicar controles transversais.

Funções:

- Autenticar usuários.
- Autorizar por papel, departamento, loja, dado e ação.
- Aplicar rate limits e budgets.
- Criar `request_id` e `trace_id`.
- Normalizar mensagens de Web, WhatsApp, Base44 e integrações.
- Encaminhar para orquestração de IA ou use cases determinísticos.

### 4.2 Router de intenção

Antes de chamar qualquer agente caro, o Hermes deve classificar intenção:

- Pergunta analítica com SQL Template existente.
- Pergunta analítica sem template.
- Consulta de conhecimento/RAG.
- Solicitação de relatório.
- Solicitação de ação operacional.
- Atendimento/FAQ.
- Pedido sensível que exige autorização ou aprovação.
- Pergunta fora de escopo.

### 4.3 SQL Templates

Camada prioritária para perguntas de dados estruturados.

Cada template deve ter:

- Nome e versão.
- Domínio dono.
- Descrição de negócio.
- Parâmetros tipados.
- SQL parametrizado.
- Limite de linhas.
- Tempo máximo.
- Papéis autorizados.
- Lojas/departamentos permitidos.
- Testes com exemplos.
- Explicação de métrica.

Regra: o modelo não deve escrever SQL livre para perguntas frequentes ou métricas oficiais.

### 4.4 Semantic Layer / Catálogo de Métricas

Camada que define métricas oficiais.

Exemplos:

- Faturamento bruto.
- Faturamento líquido.
- Ticket médio.
- Inadimplência recuperável.
- Perda provável.
- Ranking de vendedores.
- Produtos mais vendidos.
- Estoque parado.
- Giro de estoque.

Metabase deve ser considerado fonte complementar ou interface de validação para métricas já consolidadas.

### 4.5 Agent Runtime

O runtime deve suportar:

- Execução multi-step.
- Ferramentas autorizadas.
- Checkpoints.
- Retomada após falha.
- Human-in-the-loop.
- Handoffs entre agentes.
- Tracing completo.
- Políticas por ferramenta.

Referências conceituais:

- LangGraph: grafos, estado, persistência e human-in-the-loop.
- OpenAI Agents SDK: agentes, tools, handoffs, guardrails, tracing.
- CrewAI/Mastra: organização de agentes e workflows por papéis.

### 4.6 Tool Registry

Todas as ferramentas devem ser registradas e governadas.

Categorias:

- `sql_template.execute`
- `metabase.query`
- `supabase.read`
- `report.generate`
- `whatsapp.send_message`
- `n8n.trigger_workflow`
- `base44.call_app`
- `memory.read`
- `memory.write`
- `audit.log`
- `escalation.create`

Cada tool precisa de contrato, owner, política de autorização, auditoria e testes.

### 4.7 MCP como fronteira de integração

MCP deve ser avaliado como padrão para expor ferramentas, recursos e prompts de forma desacoplada. Isso evita que o core do Hermes conheça detalhes de cada sistema.

Possíveis MCP servers:

- Supabase read-only.
- Metabase dashboards/questions.
- n8n workflows.
- Base44 apps.
- Evolution API/WhatsApp.
- Documentos internos e políticas.
- Catálogo de produtos/clientes/fornecedores com políticas.

### 4.8 Memória

Memória deve ser limpa, governada e explícita.

Camadas:

1. **Memória de sessão**: contexto curto da conversa atual.
2. **Memória do usuário**: preferências e padrões aprovados.
3. **Memória do departamento**: rotinas, relatórios e métricas usadas.
4. **Memória corporativa**: conhecimento validado, políticas e decisões.
5. **Memória operacional temporal**: fatos com validade no tempo.

Práticas:

- Nunca gravar tudo automaticamente.
- Classificar memória por sensibilidade e validade.
- Permitir revisão e exclusão.
- Separar memória factual, preferência e hipótese.
- Usar temporal knowledge graph para relações que mudam no tempo, inspirado por Graphiti/Zep.
- Usar camada de memória persistente inspirada por Mem0 quando apropriado.

### 4.9 RAG / Conhecimento

RAG deve ser usado para documentos e conhecimento não estruturado:

- Políticas internas.
- Procedimentos.
- Manuais.
- Histórico de decisões.
- Contratos.
- Treinamentos.
- FAQs.

Pipeline ideal:

1. Ingestão.
2. Classificação e permissões.
3. Chunking.
4. Embeddings.
5. Índice vetorial.
6. Re-ranking.
7. Citações obrigatórias.
8. Avaliação de qualidade.
9. Retenção e expiração.

### 4.10 Event Driven Architecture

Hermes deve emitir e consumir eventos.

Eventos candidatos:

- `question.asked`
- `intent.classified`
- `template.executed`
- `agent.run.completed`
- `report.requested`
- `report.generated`
- `whatsapp.message.received`
- `escalation.created`
- `cost.threshold.exceeded`
- `audit.issue.detected`
- `memory.write.proposed`
- `memory.write.approved`

Benefícios:

- Escalabilidade.
- Retentativas.
- Processamento assíncrono.
- Auditoria natural.
- Integração com n8n e alertas.

### 4.11 Observabilidade

Obrigatório desde a fundação.

Métricas:

- Latência por etapa.
- Tokens de entrada/saída.
- Custo por usuário/departamento/canal/modelo.
- Queries executadas.
- Cache hit ratio.
- Erros por ferramenta.
- Taxa de escalonamento.
- Satisfação/feedback.
- Respostas bloqueadas por política.

Logs/traces:

- `trace_id` fim a fim.
- Prompt version.
- Tool calls.
- SQL template version.
- Modelo usado.
- Decisões de roteamento.
- Resultado de guardrails.

### 4.12 Segurança

Controles mínimos:

- Autenticação obrigatória.
- RBAC/ABAC.
- Row-level security quando possível.
- Banco read-only para IA.
- Allowlist de schemas/views.
- Bloqueio de DDL/DML.
- Mascaramento de PII.
- Auditoria imutável.
- Secrets fora do código.
- Aprovação humana para ações sensíveis.
- Data loss prevention em prompts e respostas.

## 5. Domínios sugeridos por DDD

### Core domains

- Vendas.
- Financeiro/Inadimplência.
- Estoque/Produtos.
- Compras/Fornecedores.

### Supporting domains

- RH.
- Marketing.
- Auditoria.
- Clientes.
- Relatórios.

### Generic/subdomínios de plataforma

- Autenticação.
- Notificações.
- Observabilidade.
- Custos.
- Memória.
- RAG.
- Integrações.

## 6. Agentes especializados futuros

Somente depois de segurança, templates, observabilidade e auditoria.

- Agente Diretoria: visão executiva, KPIs, alertas estratégicos.
- Agente Financeiro: inadimplência, contas, cobranças, risco.
- Agente Compras: fornecedores, reposição, giro, sazonalidade.
- Agente Estoque: rupturas, produtos parados, curva ABC.
- Agente Marketing: campanhas, segmentação, calendário comercial.
- Agente RH: escalas, treinamento, políticas.
- Agente Auditoria: anomalias, divergências, acessos.
- Agente Atendimento: clientes e fornecedores via WhatsApp.

## 7. Escalabilidade para centenas de milhares de consultas

### 7.1 Estratégia de custo

Ordem preferencial de atendimento:

1. Cache exato.
2. Cache semântico.
3. SQL Template determinístico.
4. Relatório pré-calculado/materialized view.
5. RAG com contexto mínimo.
6. Modelo barato para classificação/resumo simples.
7. Modelo avançado apenas para raciocínio complexo.

### 7.2 Estratégia de performance

- Materialized views para métricas recorrentes.
- Jobs agendados para relatórios diários/semanais.
- Filas para tarefas longas.
- Read replicas quando necessário.
- Cache Redis/KeyDB.
- Limites de query por template.
- Paginação e agregação no banco.
- Streaming apenas para interação; relatórios grandes por job.

### 7.3 Estratégia operacional

- SLOs por canal.
- Circuit breakers para LLM, banco e integrações.
- Retentativas com backoff.
- Dead-letter queue.
- Feature flags.
- Rollback de prompts/templates.
- Testes de carga.

## 8. Modelo de dados mínimo da plataforma

Tabelas recomendadas:

- `users`
- `roles`
- `departments`
- `permissions`
- `agent_sessions`
- `agent_messages`
- `agent_runs`
- `tool_calls`
- `sql_templates`
- `sql_template_versions`
- `sql_executions`
- `audit_events`
- `cost_events`
- `cache_entries`
- `reports`
- `report_runs`
- `memory_items`
- `memory_reviews`
- `knowledge_documents`
- `knowledge_chunks`
- `evaluations`
- `feedback`

## 9. Decisões iniciais recomendadas

1. Não evoluir SQL livre como padrão.
2. Criar foundation de auditoria antes de novos canais.
3. Criar catálogo de métricas antes de agentes especialistas.
4. Separar canal, agente, domínio e infraestrutura.
5. Tratar WhatsApp como canal, não como core.
6. Tratar Base44 como ecossistema de apps integrados via contratos.
7. Usar eventos para automação e escalonamento.
8. Adotar versionamento de prompts, templates e políticas.
