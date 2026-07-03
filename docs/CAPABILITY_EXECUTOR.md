# Capability Executor — modo seguro

## Objetivo

A PR-19 introduz um executor mínimo de capabilities para permitir que o chat execute uma capability resolvida de forma clara sem depender de uma nova chamada Claude. O primeiro caso suportado é `finance.daily_revenue`.

O objetivo não é criar uma nova arquitetura completa de agentes nesta etapa, mas abrir um caminho seguro para evoluir o Hermes para capabilities versionadas, auditáveis e reutilizáveis.

## Escopo da PR-19

### Incluído

- Resolver simples para identificar intenção clara de faturamento diário.
- Executor seguro em `src/hermes/capabilities/capability-executor.js`.
- Suporte inicial somente para `finance.daily_revenue`.
- Integração no `/api/chat` antes de SQL Templates e antes do fallback Claude.
- Reuso de cache em memória existente.
- Reuso da consulta analítica baseada em `public.vw_itens_vendidos`.
- Logs estruturados específicos de capability.
- Fallback seguro para o fluxo atual quando o executor não conseguir responder.

### Não incluído

- Nenhuma alteração de frontend.
- Nenhuma nova capability de alto risco.
- Nenhuma execução que exija aprovação humana.
- Nenhuma mudança no prompt principal do Claude.
- Nenhuma mudança no contrato público do endpoint `/api/chat`.

## Regras de segurança

O executor só executa uma capability quando todas as condições abaixo forem verdadeiras:

1. `status = available`.
2. `requiresApproval = false`.
3. `riskLevel = low`.
4. `capabilityId` está implementada explicitamente.
5. O resolver retornou `matchType = clear`.

Se qualquer condição falhar, a capability não é executada e o chat segue para o fluxo existente.

## Capability inicial: `finance.daily_revenue`

### Perguntas esperadas

Exemplos de perguntas que podem ser resolvidas com match claro:

- `Qual foi o faturamento de hoje?`
- `Qual foi o faturamento diário de ontem?`
- `Qual foi o faturamento em 03/07/2026?`

Perguntas ambíguas como `Qual foi o faturamento?` não devem executar a capability, porque não possuem período claro.

### Fonte de dados

A capability consulta `public.vw_itens_vendidos`, agregando por loja:

- quantidade de vendas;
- itens vendidos;
- faturamento.

A consulta filtra lojas desativadas e itens devolvidos, seguindo o padrão já usado nas consultas analíticas existentes. A data operacional é calculada com `HERMES_TIMEZONE`, usando `America/Recife` como fallback seguro.

## Cache

A capability reutiliza o cache existente em `src/hermes/cache.js`.

A chave é derivada de:

- `capabilityId`;
- versão da capability;
- parâmetros resolvidos, como `date`;
- timezone operacional (`HERMES_TIMEZONE`, default `America/Recife`).

O TTL inicial é de 10 minutos, alinhado com o perfil de dados do dia: reduz repetição de consultas durante acompanhamento operacional sem congelar o faturamento por tempo excessivo.

## Fluxo no `/api/chat`

1. O endpoint recebe a pergunta.
2. `resolveCapability(question)` tenta identificar uma capability clara.
3. Se houver match claro, o chat registra `capability_resolved`.
4. O chat chama `executeCapability(capabilityId, context)`.
5. Se a execução funcionar, o chat envia `text` e `done` via SSE e encerra a requisição sem chamar Claude.
6. Se a execução falhar, o erro é logado e o fluxo atual continua: SQL Templates e depois fallback Claude.

## Logs estruturados

A PR-19 adiciona os seguintes eventos:

- `capability_resolved`: capability detectada com match claro.
- `capability_execution_start`: início da execução.
- `capability_execution_finish`: fim da execução com sucesso, incluindo duração, cache e `rowCount`.
- `capability_execution_error`: falha ou fallback do executor.

Os eventos carregam `requestId` para correlação com os logs existentes.

## Política de fallback

O executor nunca deve quebrar o chat. Em caso de erro:

1. o erro é registrado sem SQL completo e sem dados sensíveis;
2. nenhuma resposta parcial da capability é enviada;
3. o fluxo atual continua;
4. se o fallback também falhar, o tratamento existente de erro amigável do `/api/chat` é usado.

## Validação operacional

Com Supabase real disponível, validar:

```bash
node --check server.js
node --check src/hermes/capabilities/capability-resolver.js
node --check src/hermes/capabilities/capability-executor.js
HERMES_TIMEZONE=America/Recife npm test
curl -fsS http://localhost:8080/health
curl -N http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Qual foi o faturamento de hoje?"}]}'
```

Critérios esperados:

- `finance.daily_revenue` responde sem nova chamada Claude quando a query executa com sucesso.
- Perguntas ambíguas seguem para fallback.
- Erro de query da capability não derruba o servidor.
- Logs mostram resolução, início, fim ou erro da capability.
