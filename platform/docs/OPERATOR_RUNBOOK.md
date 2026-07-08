# Hermes Core Operator Runbook

Este guia descreve o fluxo atual do Hermes Core, os limites de seguranÃ§a e o
que validar antes de qualquer alteraÃ§Ã£o futura em adapters.

## Fluxo atual

1. `POST /message` classifica `domain` e `intent`.
2. O capability registry monta o plano pÃºblico seguro.
3. O confirmation gate decide se a aÃ§Ã£o futura exigirÃ¡ confirmaÃ§Ã£o.
4. Quando necessÃ¡rio, o core cria uma confirmation pÃºblica mÃ­nima.
5. `POST /confirm` recebe `sim`, `nÃ£o` ou resposta ambÃ­gua.
6. O sistema responde com `executed: false` sempre.
7. `GET /confirm/:id` consulta o status atual da confirmation.

Estado atual: nenhum adapter real executa. Esta fase existe apenas para
planejamento seguro e contratos pÃºblicos estÃ¡veis.

Quando a policy permite, o core pode acionar um mock adapter local para
simulaÃ§Ã£o controlada. `simulated: true` significa apenas que a simulaÃ§Ã£o rodou;
nÃ£o hÃ¡ execuÃ§Ã£o real, side effect ou integraÃ§Ã£o externa.
Os mock adapters sÃ£o por domÃ­nio e expÃµem `adapter_id` pÃºblico seguro como
`mock-compras`, `mock-financeiro`, `mock-treinamento`, `mock-marketing` e
`mock-desenvolvimento`.
O Adapter Result Contract pÃºblico mantÃ©m apenas `adapter_id`, `adapter_mode`,
`domain`, `status`, `simulated`, `executed` e `message`; campos internos como
`requiredAdapters`, `payload`, `rawMessage`, `userMessage`, `secret`, `token`,
`env`, `internal` e `credentials` devem ser removidos antes de qualquer
resposta pÃºblica.
O Adapter Audit Event Contract segue o mesmo princÃ­pio: eventos sÃ£o apenas logs
seguros, com `event_type`, `trace_id`, `confirmation_id`, `domain`, `intent`,
`adapter_id`, `adapter_mode`, `status`, `executed`, `simulated` e
`timestamp`. Nenhum audit event Ã© persistido em banco nesta PR.

## Regras invariantes

- `executed: false` Ã© obrigatÃ³rio nesta fase.
- Nenhum serviÃ§o real Ã© conectado.
- Nenhum adapter real Ã© chamado.
- Nenhuma persistÃªncia durÃ¡vel Ã© usada.
- O kill switch bloqueia qualquer evoluÃ§Ã£o de execuÃ§Ã£o futura.
- `simulated: true` nunca equivale a execuÃ§Ã£o real.
- `adapter_id` pÃºblico sÃ³ pode apontar para um mock seguro de domÃ­nio.

## Como testar localmente

### 1. Verificar saÃºde

```bash
curl localhost:8080/health
```

Resposta esperada: `{"status":"ok","service":"hermes-api",...}`.

### 2. Enviar uma mensagem

```bash
curl -X POST localhost:8080/message \
  -H "Content-Type: application/json" \
  -d '{"message":"ver caixa e faturamento do mes"}'
```

O retorno deve incluir `trace_id`, `domain`, `intent`, `status`, `message`,
`confirmation_required` e, quando aplicÃ¡vel, `confirmation`.

### 3. Capturar `confirmation_id`

Quando `confirmation_required=true`, o campo `confirmation.id` Ã© o identificador
pÃºblico da confirmaÃ§Ã£o pendente.

### 4. Confirmar com `sim`

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"sim"}'
```

O retorno precisa manter `executed:false`.

### 5. Confirmar com `nÃ£o`

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"nao"}'
```

O retorno precisa manter `executed:false` e registrar a decisÃ£o como rejeitada.

### 6. Consultar status

```bash
curl localhost:8080/confirm/confirm_...
```

O retorno pode ser `pending`, `approved`, `rejected`, `expired` ou `not_found`.

### 7. Provar `not_found`

```bash
curl localhost:8080/confirm/confirm_inexistente
```

O retorno deve ser seguro e continuar com `executed:false`.

### 8. Rodar o smoke test end-to-end

```bash
cd platform
docker compose up --build -d
bash scripts/hermes-smoke-test.sh
```

O `docker compose` local sobe a API com `HERMES_EXECUTION_ENABLED=true` para
permitir a validaÃ§Ã£o do caminho `simulated:true` sem execuÃ§Ã£o real. O script usa
`API_BASE_URL=http://localhost:8080` por padrÃ£o e cobre:

- `GET /health`
- `POST /message` para compras, financeiro, treinamento, marketing e
  desenvolvimento
- `GET /confirm/:confirmation_id`
- `POST /confirm` com `sim`
- `POST /confirm` com `confirmation_id` inexistente

Sucesso significa que o fluxo completo respondeu sem expor `requiredAdapters`,
payload interno, `rawMessage`, `userMessage`, tokens ou segredos. Falha no
script significa que algum contrato seguro foi quebrado e a PR deve ser
ajustada antes de seguir.

## 9. CI smoke workflow

O workflow `.github/workflows/hermes-core-smoke.yml` roda em `pull_request` e
`push` para `main`. Ele executa as mesmas validaÃ§Ãµes bÃ¡sicas do fluxo local:

- checkout do repositÃ³rio
- setup de Node compatÃ­vel
- `npm install` em `platform/services/api`
- `node --check` nos JS de `platform/services/api`
- `npm test` em `platform/services/api`
- `docker compose config`
- `docker compose up --build -d`
- `bash scripts/hermes-smoke-test.sh`
- `docker compose down` no final, mesmo se houver falha

Esse workflow nÃ£o usa segredos, nÃ£o chama serviÃ§os externos e nÃ£o altera o
contrato de `executed:false`.

## 10. Permission Matrix e Golden Scenarios

Antes de criar um domÃ­nio novo, consulte `docs/PERMISSION_MATRIX.md` e
`docs/GOLDEN_SCENARIOS.md`. Eles funcionam como contrato prÃ©vio para decidir:

- se o domÃ­nio pode ler contexto
- se pode planejar
- se pode solicitar confirmaÃ§Ã£o
- se pode rodar mock adapter
- se continua proibido de executar aÃ§Ã£o real

Checklist mÃ­nimo para domÃ­nio novo:

- declarar domÃ­nio na matriz
- definir `risk_level`
- definir capabilities
- criar mock adapter
- criar golden scenarios
- adicionar testes
- atualizar smoke/CI se necessÃ¡rio
- manter `executed:false`
- revisar por humano

Esses documentos devem ser atualizados antes de qualquer PR futura de adapter
real.

## 11. Domain Onboarding Guide

`docs/DOMAIN_ONBOARDING.md` Ã© o guia oficial para qualquer domÃ­nio novo. Ele
exige `mock-first`, `executed:false`, revisÃ£o humana, `mock-*` adapter id,
Permission Matrix e Golden Scenarios atualizados antes de qualquer promoÃ§Ã£o.

O checklist mÃ­nimo cobre:

- nome canÃ´nico do domÃ­nio
- escopo e intents
- `risk_level`
- capabilities
- fixture e testes contratuais
- smoke/CI quando o domÃ­nio entrar no fluxo end-to-end
- verificaÃ§Ã£o de forbidden fields e segredos

Sem esse guia aprovado, o domÃ­nio nÃ£o deve avanÃ§ar para adapter real.

## 12. Skill Candidate Registry

`docs/SKILL_CANDIDATE_REGISTRY.md` Ã© o contrato oficial para skills candidatas.
Ele existe sÃ³ como base documental nesta fase:

- comeÃ§a em `draft`
- permanece mock-first
- exige revisÃ£o humana
- exige `executed:false`
- nÃ£o cria skill executÃ¡vel real

Antes de promover uma skill candidata, valide o domÃ­nio, a Permission Matrix,
os Golden Scenarios e o rollback plan.

## 13. Memory Policy

`docs/MEMORY_POLICY.md` documenta as camadas oficiais de memÃ³ria sem criar
storage real nesta PR. Ela cobre session, user/peer, domain/company e
audit/learning memory, thresholds por domÃ­nio e forbidden fields.

Regras centrais:

- memÃ³ria nÃ£o autoriza `executed:true`
- memÃ³ria nÃ£o substitui confirmaÃ§Ã£o humana
- memÃ³ria nÃ£o pode misturar usuÃ¡rios, empresas ou domÃ­nios
- memÃ³ria nÃ£o pode guardar `token`, `secret`, `env`, `headers`, `cookies`,
  `credentials`, `payload`, `rawMessage`, `userMessage` ou `requiredAdapters`
- memÃ³ria nÃ£o cria segundo cÃ©rebro real nesta fase
- `docs/USER_PEER_MEMORY_SCOPES.md` detalha a camada `user_peer` sem alterar o
  contrato de runtime.
- `docs/SECOND_BRAIN_INBOX_CONTRACT.md` define o inbox futuro do segundo
  cÃ©rebro sem storage real, RAG real ou execuÃ§Ã£o real.
## Kill switch

- `HERMES_EXECUTION_KILL_SWITCH=true` bloqueia qualquer execuÃ§Ã£o futura.
- `HERMES_EXECUTION_ENABLED=true` nÃ£o habilita adapter real nesta fase.
- Mesmo com `HERMES_EXECUTION_ENABLED=true`, o sistema continua sem executar
  nada real.

## Logs permitidos

- `message_received`
- `capability_planned`
- `confirmation_gate_evaluated`
- `confirmation_created`
- `confirmation_store_created`
- `confirmation_response_received`
- `confirmation_store_resolved`
- `confirmation_store_miss`
- `confirmation_status_checked`
- `execution_policy_evaluated`
- `adapter_execution_planned`
- `mock_adapter_simulated`
- `domain_mock_adapter_selected`
- `domain_mock_adapter_missing`
- `adapter_result_sanitized`
- `adapter_result_validated`
- `adapter_audit_event_created`
- `adapter_audit_event_sanitized`
- `adapter_audit_event_validated`

## Logs proibidos

- Mensagem crua do usuÃ¡rio.
- `requiredAdapters` como lista.
- Payload interno.
- Segredos.
- `env` completo.

## Dados que nunca devem aparecer

- Mensagem crua do usuÃ¡rio em response ou log.
- `requiredAdapters`.
- Payload interno de confirmaÃ§Ã£o.
- Segredos.
- VariÃ¡veis de ambiente completas.
- Qualquer dado que revele execuÃ§Ã£o real ou integraÃ§Ã£o externa.
- `adapter_id` fora da lista de mocks seguros por domÃ­nio.

## Checklist antes de qualquer PR futura de adapter real

- Confirmar que a PR Ã© pequena e por domÃ­nio.
- Confirmar que existe teste de confirmaÃ§Ã£o para o fluxo afetado.
- Confirmar que o kill switch foi testado.
- Confirmar que `executed:false` continua obrigatÃ³rio.
- Confirmar que o mock adapter continua local e nÃ£o chama serviÃ§o real.
- Confirmar que o `adapter_id` pÃºblico segue o domÃ­nio mock correto.
- Confirmar que nenhum serviÃ§o real foi conectado.
- Confirmar que o adapter inicial pode ser mock/fake.
- Confirmar que a documentaÃ§Ã£o foi atualizada.

## Checklist de rollback

- Reverter a PR atual.
- Verificar que `executed:false` voltou ao comportamento anterior.
- Confirmar que o kill switch continua bloqueando.
- Validar `/health`, `POST /message`, `POST /confirm` e `GET /confirm/:id`.
- Validar que `simulated:true` aparece apenas em simulaÃ§Ã£o local.
- Validar que `adapter_id` aparece apenas em simulaÃ§Ã£o local e por domÃ­nio.

## Checklist de validaÃ§Ã£o local

- `node --check` nos JS de `platform/services/api`.
- `npm test` em `platform/services/api`.
- `curl /health`.
- `curl POST /message`.
- `curl POST /confirm`.
- `curl GET /confirm/:id`.
- Validar `executed:false` em todos os caminhos.
- Validar que `simulated:true` sÃ³ aparece quando o mock roda localmente.
- Validar que `adapter_id` pÃºblico corresponde ao domÃ­nio.

## Rules for future adapter PRs

- Adapter real sÃ³ pode entrar em PR pequena por domÃ­nio.
- ComeÃ§ar por um adapter fake/mock.
- Requer testes de confirmaÃ§Ã£o do fluxo.
- Requer kill switch testado.
- Requer `executed:false` atÃ© liberaÃ§Ã£o explÃ­cita em PR separada.
- Requer mock adapter inicial antes de qualquer adapter real.
- Requer registry por domÃ­nio aprovado antes de ampliar o escopo.
- Nunca conectar serviÃ§o real sem variÃ¡vel de ambiente e documentaÃ§Ã£o.
- Nunca logar payload sensÃ­vel.
- Nunca expor `requiredAdapters` ou segredos em response pÃºblico.

## User Peer Memory Scopes

`docs/USER_PEER_MEMORY_SCOPES.md` detalha a camada `user_peer`, cobrindo
escopos por papel, campos permitidos, campos proibidos, isolamento por usuÃ¡rio
e relaÃ§Ã£o com Permission Matrix, Skill Candidate Registry e segundo cÃ©rebro
futuro.

## Second Brain Inbox Contract

`docs/SECOND_BRAIN_INBOX_CONTRACT.md` define o contrato oficial do inbox do
futuro segundo cÃ©rebro, sem storage real, RAG real ou execuÃ§Ã£o real.

