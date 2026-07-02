# NEXT_PR_PLAN.md

Plano crítico das próximas Pull Requests do Hermes, após revisão dos documentos `HERMES_AUDIT.md`, `HERMES_ARCHITECTURE.md`, `ROADMAP.md` e `PROJECT_PRINCIPLES.md` contra o estado real do repositório atual.

> Data: 02/07/2026.
> Escopo: planejamento técnico. Nenhuma funcionalidade deve ser implementada nesta etapa.

## 1. Revisão crítica da arquitetura vs. estado real do projeto

### 1.1 Diagnóstico geral

A arquitetura proposta está conceitualmente correta para o Hermes como plataforma corporativa de IA, mas está muito à frente do estado real do código. O repositório atual ainda é um MVP extremamente concentrado:

- Um único backend em `server.js`.
- Um único frontend em `public/index.html`.
- Um único endpoint principal: `POST /api/chat`.
- Um único agente genérico baseado em Claude.
- Uma única ferramenta: `query_database`.
- SQL livre gerado pelo modelo.
- Sem autenticação.
- Sem autorização.
- Sem logs estruturados.
- Sem persistência de conversas.
- Sem cache.
- Sem SQL Templates.
- Sem testes automatizados.
- Sem camada de domínio.
- Sem filas, eventos, workers ou observabilidade.

Portanto, a arquitetura está coerente como norte estratégico, mas a execução precisa ser incremental e pragmática. A próxima sequência de PRs não deve tentar introduzir LangGraph, MCP, multiagentes, memória longa ou Event Driven Architecture imediatamente. Antes disso, o Hermes precisa resolver confiabilidade, custo, tempo de resposta, SQL controlado e visibilidade operacional.

### 1.2 Coerências identificadas

A documentação está alinhada ao problema real em cinco pontos fundamentais:

1. **SQL livre é o maior risco técnico e operacional atual.**
   O código permite que o modelo produza SQL diretamente para o banco. Isso explica parte do risco de lentidão, varreduras grandes, respostas inconsistentes e custo imprevisível.

2. **SQL Templates são a fundação correta.**
   Para perguntas recorrentes como faturamento, inadimplência, produtos mais vendidos, ticket médio e vendedores, o caminho correto é executar consultas parametrizadas e testadas antes de chamar o agente completo.

3. **Cache deve vir antes de IA para perguntas repetidas.**
   A interface já sugere perguntas frequentes; essas perguntas são candidatas naturais para cache e templates.

4. **Observabilidade é pré-requisito de melhoria.**
   Hoje não há dados confiáveis para responder: quanto demorou a chamada ao Claude, quanto demorou o SQL, quantas linhas voltaram, qual SQL foi executado, onde travou, qual erro ocorreu ou se o cliente desconectou.

5. **A separação em camadas está correta, mas não deve virar reescrita grande.**
   O projeto deve sair do monólito gradualmente, extraindo módulos pequenos sem quebrar o MVP.

### 1.3 Lacunas na documentação inicial

Os quatro documentos criados são bons como fundação, mas faltava um plano operacional de PRs pequenas. Em especial, faltava transformar princípios em sequência concreta de implementação.

Lacunas agora cobertas por este plano:

- Qual PR vem primeiro.
- Como resolver o problema imediato de respostas demorando ou não entregando.
- Quais arquivos provavelmente serão tocados.
- Como testar cada PR.
- Critérios objetivos de aceite.
- Risco por PR.

### 1.4 Ajuste de prioridade recomendado

A ordem prática deve ser:

1. **Logs, rastreabilidade e confiabilidade do endpoint atual.**
2. **SQL Templates para perguntas frequentes e complexas.**
3. **Cache para respostas/template results.**
4. **Limites de segurança para SQL livre remanescente.**
5. **Testes automatizados mínimos.**
6. **Modularização gradual.**

Motivo: sem logs, qualquer otimização vira tentativa e erro; sem SQL Templates, respostas complexas continuarão dependendo do modelo escrever SQL e interpretar resultados; sem cache, perguntas repetidas continuarão caras e lentas.

## 2. PR que deve vir primeiro para o problema atual

### PR recomendada como primeira: PR-01 — Confiabilidade e logs estruturados do `/api/chat`

Para o problema atual de **respostas complexas demorando ou não entregando**, a primeira PR deve ser de confiabilidade e diagnóstico, não de arquitetura grande.

Justificativa:

- Hoje não é possível saber com precisão se a demora está no Claude, no SQL, na quantidade de linhas retornadas, no parse de JSON, no loop de tool calls, no timeout, no Railway, no Supabase ou no navegador.
- O endpoint pode ficar até 3 minutos aberto, mas não há heartbeat SSE, eventos de progresso detalhados, medição de etapas ou logs por `request_id`.
- Sem instrumentação, a PR seguinte de SQL Templates pode melhorar performance, mas continuaremos cegos quando algo falhar.

A PR-01 não deve tentar resolver todos os problemas de performance. Ela deve tornar o problema visível, reproduzível e mais confiável. A PR-02 deve atacar a causa principal de lentidão: consultas complexas dependerem de SQL livre gerado pelo modelo.

## 3. Sequência ideal de próximas PRs pequenas

## PR-01 — Confiabilidade e logs estruturados do endpoint de chat

### Objetivo

Instrumentar o fluxo atual sem alterar a experiência principal, para entender e reduzir falhas em respostas longas ou complexas.

### Arquivos prováveis

- `server.js`
- `package.json` apenas se for adicionada dependência leve de logging; preferencialmente evitar no primeiro passo.
- `docs/HERMES_AUDIT.md` para registrar achados, se necessário.
- `README.md` para documentar variáveis/configurações novas, se houver.

### Escopo recomendado

- Criar `request_id` por chamada.
- Logar início/fim de request.
- Logar duração da chamada ao Claude.
- Logar duração de cada SQL.
- Logar `rowCount` retornado.
- Logar erros com contexto mínimo seguro.
- Enviar eventos SSE de progresso mais claros.
- Adicionar heartbeat SSE para conexões longas.
- Detectar `req.on('close')` para parar trabalho quando cliente desconectar.
- Limitar número máximo de iterações de tool use por request.
- Diferenciar erro de Claude, erro de banco, timeout e erro inesperado.

### Risco

Baixo a médio.

Risco principal: alterar o fluxo SSE e quebrar a interface se os eventos não forem compatíveis. Mitigação: manter eventos atuais (`querying`, `text`, `error`, `done`) e apenas adicionar campos/eventos opcionais.

### Critérios de aceite

- Cada request tem um `request_id` nos logs.
- Logs mostram tempo total, tempo de Claude, tempo de SQL e quantidade de linhas.
- Erros são classificados por tipo.
- Cliente continua recebendo respostas no formato atual.
- Conexões longas recebem heartbeat ou evento de progresso.
- Existe limite de iterações para evitar loops de tool calls.

### Como testar

- `node --check server.js`
- `npm start`
- `curl -fsS http://localhost:8080/health`
- Enviar uma pergunta simples pelo `/api/chat` e validar eventos SSE.
- Enviar uma pergunta que acione SQL e validar logs com `request_id`, duração e `rowCount`.
- Simular erro de banco com `DATABASE_URL` inválida e verificar mensagem controlada.

---

## PR-02 — SQL Templates v1 para perguntas frequentes e respostas complexas

### Objetivo

Criar o primeiro caminho determinístico e rápido para perguntas recorrentes, reduzindo dependência de SQL livre gerado pelo modelo.

### Arquivos prováveis

- `server.js`
- `src/sqlTemplates.js` ou `src/templates/sqlTemplates.js`
- `src/intentRouter.js` ou equivalente simples
- `test/` ou `tests/` se a PR também introduzir testes mínimos
- `README.md`
- `docs/HERMES_ARCHITECTURE.md` ou `docs/HERMES_AUDIT.md` para registrar o novo padrão

### Escopo recomendado

Criar templates para as perguntas que já aparecem na interface:

1. Faturamento por loja em mês específico.
2. Inadimplência recuperável por loja.
3. Comparativo de faturamento ano contra ano por loja.
4. Top 10 produtos vendidos em período.
5. Melhores vendedores em ano/período.
6. Ticket médio por loja em período.

Implementação deve ser simples:

- Detectar intenção por regras/regex inicialmente.
- Extrair parâmetros básicos: mês, ano, período, loja, limite.
- Executar SQL parametrizado com `pg`.
- Retornar resultado formatado ou passar resultado ao modelo apenas para redação curta.
- Colocar limite explícito de linhas.
- Colocar timeout por template.

### Risco

Médio.

Risco principal: templates divergirem das métricas esperadas pelo negócio. Mitigação: começar com templates pequenos, documentar SQL e comparar com respostas atuais/Metabase quando possível.

### Critérios de aceite

- Pelo menos 3 perguntas frequentes passam por template sem SQL livre do LLM.
- Templates usam parâmetros, não concatenação insegura.
- Cada template tem nome, descrição, parâmetros e limite de linhas.
- Logs mostram quando um template foi usado.
- Perguntas cobertas respondem mais rápido que o fluxo agente + SQL livre.
- Perguntas não cobertas continuam caindo no agente atual.

### Como testar

- `node --check server.js`
- `npm start`
- `curl -fsS http://localhost:8080/health`
- Testar as perguntas frequentes da tela inicial.
- Validar que perguntas cobertas geram log `template_used`.
- Validar que pergunta fora do template ainda chama o agente.
- Testar parâmetros inválidos: mês inexistente, ano ausente, limite exagerado.

---

## PR-03 — Cache em memória para SQL Templates e perguntas frequentes

### Objetivo

Reduzir latência, custo e carga no Supabase para consultas repetidas.

### Arquivos prováveis

- `server.js`
- `src/cache.js`
- `src/sqlTemplates.js`
- `README.md`

### Escopo recomendado

- Cache in-memory com TTL curto por template + parâmetros.
- Chave de cache determinística.
- TTL por tipo de métrica.
- Log de `cache_hit` e `cache_miss`.
- Cabeçalho ou campo SSE indicando cache quando aplicável.
- Invalidação simples por TTL, sem Redis ainda.

### Risco

Baixo a médio.

Risco principal: retornar dado desatualizado. Mitigação: TTL conservador e indicação explícita do período consultado.

### Critérios de aceite

- Segunda execução da mesma pergunta/template usa cache.
- Logs exibem `cache_hit`.
- TTL configurável.
- Cache não é usado para perguntas fora de template.
- Cache pode ser desativado por variável de ambiente, se necessário.

### Como testar

- `node --check server.js`
- `npm start`
- Executar a mesma pergunta duas vezes.
- Confirmar nos logs: primeira `cache_miss`, segunda `cache_hit`.
- Reduzir TTL em ambiente local e confirmar expiração.

---

## PR-04 — Guardrails mínimos para SQL livre remanescente

### Objetivo

Reduzir risco enquanto o Hermes ainda precisar suportar SQL gerado pelo modelo para perguntas não cobertas por templates.

### Arquivos prováveis

- `server.js`
- `src/sqlGuardrails.js`
- `src/db.js`
- `README.md`

### Escopo recomendado

- Permitir apenas `SELECT`.
- Bloquear `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `COPY`.
- Bloquear múltiplas statements.
- Exigir `LIMIT` para consultas detalhadas.
- Impor limite máximo de linhas retornadas.
- Permitir apenas schemas/views autorizadas inicialmente.
- Logar query bloqueada sem expor dados sensíveis.

### Risco

Médio.

Risco principal: bloquear consultas legítimas do agente. Mitigação: começar em modo permissivo com logs ou liberar apenas views públicas já documentadas.

### Critérios de aceite

- SQL perigoso é bloqueado antes de chegar ao banco.
- SQL com múltiplas statements é bloqueado.
- Queries permitidas continuam funcionando.
- Erros de bloqueio são explicados ao usuário de forma simples.

### Como testar

- `node --check server.js`
- Testar SQL permitido via ferramenta/função.
- Testar comandos proibidos.
- Testar query sem `LIMIT` quando aplicável.
- Testar acesso a schema não permitido.

---

## PR-05 — Testes automatizados mínimos para templates, cache e guardrails

### Objetivo

Criar rede mínima de segurança para evoluir sem quebrar o MVP.

### Arquivos prováveis

- `package.json`
- `package-lock.json`
- `tests/` ou `test/`
- `src/sqlTemplates.js`
- `src/cache.js`
- `src/sqlGuardrails.js`

### Escopo recomendado

- Adicionar test runner simples do Node ou dependência leve.
- Testar matching de intenções.
- Testar montagem de parâmetros.
- Testar cache hit/miss.
- Testar bloqueios SQL.
- Testar endpoint `/health`.

### Risco

Baixo.

Risco principal: introduzir ferramenta de testes pesada demais. Mitigação: usar `node:test` se a versão do Node suportar.

### Critérios de aceite

- `npm test` existe.
- Testes rodam localmente sem credenciais reais.
- Casos críticos de templates e guardrails cobertos.

### Como testar

- `npm test`
- `npm start`
- `curl -fsS http://localhost:8080/health`

---

## PR-06 — Extração mínima de módulos sem reescrita

### Objetivo

Reduzir acoplamento do `server.js` sem alterar comportamento funcional.

### Arquivos prováveis

- `server.js`
- `src/db.js`
- `src/anthropicClient.js`
- `src/agent.js`
- `src/sse.js`
- `src/config.js`

### Escopo recomendado

- Extrair conexão com banco.
- Extrair chamada ao Claude.
- Extrair helpers de SSE.
- Extrair prompt para arquivo próprio.
- Manter endpoint e frontend iguais.

### Risco

Médio.

Risco principal: regressão por refactor. Mitigação: fazer somente depois de logs, templates, cache, guardrails e testes mínimos.

### Critérios de aceite

- Comportamento externo permanece igual.
- `server.js` fica menor e focado em HTTP.
- Testes existentes continuam passando.

### Como testar

- `npm test`
- `node --check server.js`
- `npm start`
- `curl -fsS http://localhost:8080/health`
- Testar uma conversa simples e uma pergunta com template.

---

## PR-07 — Persistência leve de auditoria operacional

### Objetivo

Persistir eventos mínimos para investigação e governança, sem implementar ainda todo o modelo corporativo.

### Arquivos prováveis

- `server.js`
- `src/auditLog.js`
- `src/db.js`
- `migrations/` ou `sql/`
- `README.md`

### Escopo recomendado

- Criar tabela simples de auditoria ou logs operacionais, se permitido no Supabase.
- Persistir `request_id`, timestamp, tipo de evento, duração, template, erro e metadados seguros.
- Não persistir conteúdo sensível integral no início.

### Risco

Médio.

Risco principal: precisar de permissão real no Supabase e política clara de retenção. Mitigação: começar com SQL de migration documentado, não aplicado automaticamente.

### Critérios de aceite

- Eventos críticos podem ser consultados depois.
- Falhas de auditoria não derrubam a resposta ao usuário.
- Dados sensíveis não são gravados sem necessidade.

### Como testar

- `npm test`
- Aplicar migration em ambiente de teste, se disponível.
- Executar pergunta e verificar registro de auditoria.
- Simular falha de auditoria e confirmar que chat responde.

---

## PR-08 — Respostas em modo relatório assíncrono para consultas muito longas

### Objetivo

Evitar que relatórios grandes dependam de uma conexão HTTP/SSE aberta por minutos.

### Arquivos prováveis

- `server.js`
- `src/jobs.js`
- `src/reports.js`
- `public/index.html`
- `README.md`

### Escopo recomendado

- Detectar consultas longas ou relatórios pesados.
- Responder com mensagem de aceite: relatório em processamento.
- Criar mecanismo simples de job em memória ou banco.
- Permitir polling de status.
- Futuramente substituir por fila real.

### Risco

Médio a alto.

Risco principal: adicionar complexidade de estado. Mitigação: fazer apenas depois que templates, cache, logs e testes estiverem sólidos.

### Critérios de aceite

- Consultas longas não travam a conversa.
- Usuário recebe status claro.
- Falhas do job são registradas.

### Como testar

- `npm test`
- Simular relatório longo.
- Verificar criação, status, conclusão e erro do job.

## 4. Ordem consolidada recomendada

1. **PR-01 — Confiabilidade e logs estruturados do endpoint de chat.**
2. **PR-02 — SQL Templates v1 para perguntas frequentes e respostas complexas.**
3. **PR-03 — Cache em memória para SQL Templates e perguntas frequentes.**
4. **PR-04 — Guardrails mínimos para SQL livre remanescente.**
5. **PR-05 — Testes automatizados mínimos.**
6. **PR-06 — Extração mínima de módulos sem reescrita.**
7. **PR-07 — Persistência leve de auditoria operacional.**
8. **PR-08 — Respostas em modo relatório assíncrono para consultas muito longas.**

## 5. Sequência focada no problema de respostas complexas

Se a prioridade absoluta for resolver rapidamente respostas complexas demorando ou não entregando, a sequência curta deve ser:

1. **PR-01:** logs, heartbeat SSE, limites de loop, classificação de erros e medição de tempo.
2. **PR-02:** templates para consultas complexas mais comuns.
3. **PR-03:** cache dos templates.
4. **PR-04:** limites/guardrails em SQL livre.

Essa sequência resolve o problema por camadas:

- PR-01 mostra onde está falhando.
- PR-02 reduz dependência do LLM para SQL complexo.
- PR-03 reduz repetição e custo.
- PR-04 impede que consultas não-template derrubem performance ou segurança.

## 6. O que não fazer agora

Não recomendo para as próximas PRs imediatas:

- Migrar para LangGraph agora.
- Criar multiagentes agora.
- Implementar memória longa agora.
- Integrar WhatsApp antes de estabilizar Web/API.
- Criar MCP servers antes de organizar tools internas.
- Reescrever frontend.
- Trocar stack.
- Implementar RAG antes de SQL Templates e auditoria.
- Adicionar filas/event bus antes de entender gargalos reais.

Esses itens continuam importantes, mas devem vir depois da fundação operacional.

## 7. Decisão solicitada ao responsável do projeto

Antes da próxima implementação, aprovar uma destas opções:

### Opção A — Recomendada

Começar pela **PR-01 — Confiabilidade e logs estruturados do endpoint de chat**.

Melhor quando o objetivo é reduzir risco e entender precisamente por que respostas complexas não entregam.

### Opção B — Mais agressiva em performance

Começar pela **PR-02 — SQL Templates v1**.

Melhor quando já se sabe quais perguntas estão falhando e a urgência é acelerar respostas recorrentes, aceitando menos visibilidade inicial.

### Recomendação final

A recomendação técnica é **Opção A**. Em seguida, fazer PR-02 imediatamente. Isso equilibra confiabilidade, performance, custo e capacidade de diagnóstico.
