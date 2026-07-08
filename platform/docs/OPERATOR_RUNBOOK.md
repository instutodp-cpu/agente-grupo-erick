# Hermes Core Operator Runbook

Este guia descreve o fluxo atual do Hermes Core, os limites de segurança e o
que validar antes de qualquer alteração futura em adapters.

## Fluxo atual

1. `POST /message` classifica `domain` e `intent`.
2. O capability registry monta o plano público seguro.
3. O confirmation gate decide se a ação futura exigirá confirmação.
4. Quando necessário, o core cria uma confirmation pública mínima.
5. `POST /confirm` recebe `sim`, `não` ou resposta ambígua.
6. O sistema responde com `executed: false` sempre.
7. `GET /confirm/:id` consulta o status atual da confirmation.

Estado atual: nenhum adapter real executa. Esta fase existe apenas para
planejamento seguro e contratos públicos estáveis.

Quando a policy permite, o core pode acionar um mock adapter local para
simulação controlada. `simulated: true` significa apenas que a simulação rodou;
não há execução real, side effect ou integração externa.
Os mock adapters são por domínio e expõem `adapter_id` público seguro como
`mock-compras`, `mock-financeiro`, `mock-treinamento`, `mock-marketing` e
`mock-desenvolvimento`.
O Adapter Result Contract público mantém apenas `adapter_id`, `adapter_mode`,
`domain`, `status`, `simulated`, `executed` e `message`; campos internos como
`requiredAdapters`, `payload`, `rawMessage`, `userMessage`, `secret`, `token`,
`env`, `internal` e `credentials` devem ser removidos antes de qualquer
resposta pública.

## Regras invariantes

- `executed: false` é obrigatório nesta fase.
- Nenhum serviço real é conectado.
- Nenhum adapter real é chamado.
- Nenhuma persistência durável é usada.
- O kill switch bloqueia qualquer evolução de execução futura.
- `simulated: true` nunca equivale a execução real.
- `adapter_id` público só pode apontar para um mock seguro de domínio.

## Como testar localmente

### 1. Verificar saúde

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
`confirmation_required` e, quando aplicável, `confirmation`.

### 3. Capturar `confirmation_id`

Quando `confirmation_required=true`, o campo `confirmation.id` é o identificador
público da confirmação pendente.

### 4. Confirmar com `sim`

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"sim"}'
```

O retorno precisa manter `executed:false`.

### 5. Confirmar com `não`

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"nao"}'
```

O retorno precisa manter `executed:false` e registrar a decisão como rejeitada.

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

## Kill switch

- `HERMES_EXECUTION_KILL_SWITCH=true` bloqueia qualquer execução futura.
- `HERMES_EXECUTION_ENABLED=true` não habilita adapter real nesta fase.
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
- `domain_mock_adapter_selected`
- `domain_mock_adapter_missing`

## Logs proibidos

- Mensagem crua do usuário.
- `requiredAdapters` como lista.
- Payload interno.
- Segredos.
- `env` completo.

## Dados que nunca devem aparecer

- Mensagem crua do usuário em response ou log.
- `requiredAdapters`.
- Payload interno de confirmação.
- Segredos.
- Variáveis de ambiente completas.
- Qualquer dado que revele execução real ou integração externa.
- `adapter_id` fora da lista de mocks seguros por domínio.

## Checklist antes de qualquer PR futura de adapter real

- Confirmar que a PR é pequena e por domínio.
- Confirmar que existe teste de confirmação para o fluxo afetado.
- Confirmar que o kill switch foi testado.
- Confirmar que `executed:false` continua obrigatório.
- Confirmar que o mock adapter continua local e não chama serviço real.
- Confirmar que o `adapter_id` público segue o domínio mock correto.
- Confirmar que nenhum serviço real foi conectado.
- Confirmar que o adapter inicial pode ser mock/fake.
- Confirmar que a documentação foi atualizada.

## Checklist de rollback

- Reverter a PR atual.
- Verificar que `executed:false` voltou ao comportamento anterior.
- Confirmar que o kill switch continua bloqueando.
- Validar `/health`, `POST /message`, `POST /confirm` e `GET /confirm/:id`.
- Validar que `simulated:true` aparece apenas em simulação local.
- Validar que `adapter_id` aparece apenas em simulação local e por domínio.

## Checklist de validação local

- `node --check` nos JS de `platform/services/api`.
- `npm test` em `platform/services/api`.
- `curl /health`.
- `curl POST /message`.
- `curl POST /confirm`.
- `curl GET /confirm/:id`.
- Validar `executed:false` em todos os caminhos.
- Validar que `simulated:true` só aparece quando o mock roda localmente.
- Validar que `adapter_id` público corresponde ao domínio.

## Rules for future adapter PRs

- Adapter real só pode entrar em PR pequena por domínio.
- Começar por um adapter fake/mock.
- Requer testes de confirmação do fluxo.
- Requer kill switch testado.
- Requer `executed:false` até liberação explícita em PR separada.
- Requer mock adapter inicial antes de qualquer adapter real.
- Requer registry por domínio aprovado antes de ampliar o escopo.
- Nunca conectar serviço real sem variável de ambiente e documentação.
- Nunca logar payload sensível.
- Nunca expor `requiredAdapters` ou segredos em response público.
