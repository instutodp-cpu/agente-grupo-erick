# Hermes Core Skill Candidate Registry

Registro oficial de skills candidatas do Hermes Core. Uma skill candidata é um
padrão de tarefa observado no sistema que pode virar documentação operacional
ou contrato futuro, mas nesta fase nunca executa ação real.

## O que é uma skill candidata

- Uma skill candidata é um draft de comportamento reutilizável.
- Ela descreve um padrão de intenção, entrada, saída e revisão humana.
- Ela sempre começa como `draft`.
- Ela pode evoluir para contratos mais formais, mas não executa nada sozinha.

## O que não é uma skill candidata

- Não é uma skill executável automática.
- Não é um adapter real.
- Não é um scheduler.
- Não é uma automação autônoma de produção.
- Não é um mecanismo para contornar `executed:false`.

## Regras obrigatórias

- Nenhuma skill candidata pode executar ação real.
- Toda skill candidata começa como `draft`.
- Toda skill candidata exige revisão humana antes de qualquer promoção.
- Toda skill candidata deve permanecer ligada a um domínio existente.
- Toda skill candidata deve apontar para capability existente ou proposta.
- Toda skill candidata deve passar por Permission Matrix.
- Toda skill candidata deve passar por Golden Scenarios.
- Toda skill candidata deve usar adapter mock.
- Toda skill candidata deve explicitar `risk_level`.
- Toda skill candidata deve registrar forbidden fields.
- Toda skill candidata deve documentar criteria de aceite e rollback.
- Toda skill candidata exige human review obrigatória.
- `executed:false` continua obrigatório.

## Estados permitidos

Estados permitidos nesta fase:

- `draft`
- `proposed`
- `approved_for_mock`
- `rejected`
- `deprecated`

Estados proibidos nesta fase:

- `active_real`
- `execute_real`
- `production_autonomous`
- qualquer estado que permita execução real

## Template copiável

```text
skill_id:
name:
description:
domain:
intent:
capability_id:
status: draft
risk_level:
trigger_examples:
required_inputs:
output_contract:
confirmation_required: true
human_review_required: true
adapter_mode: mock
adapter_id:
simulated: true
executed: false
forbidden_fields:
golden_scenarios:
acceptance_criteria:
rollback_plan:
owner_human:
created_from_pattern:
notes:
```

## Ligações obrigatórias

Uma skill candidata só pode existir se estiver ligada a:

- um domínio existente
- uma capability existente ou proposta
- `docs/PERMISSION_MATRIX.md`
- `docs/GOLDEN_SCENARIOS.md`
- um mock adapter seguro
- `risk_level`
- acceptance criteria
- forbidden fields
- rollback plan

## Exemplo fictício: compras

```text
skill_id: candidate-compras-registrar-compra
name: Registrar compra
description: Padrão para registrar uma compra ficticia com revisao humana.
domain: compras
intent: registrar_compra
capability_id: compras.registrar_compra
status: draft
risk_level: high
trigger_examples: registrar compra, novo pedido, solicitar fornecedor
required_inputs: fornecedor, valor, prazo
output_contract: resposta publica segura sem payload interno
confirmation_required: true
human_review_required: true
adapter_mode: mock
adapter_id: mock-compras
simulated: true
executed: false
forbidden_fields: token, secret, env, headers, cookies, credentials, payload, rawMessage, userMessage
golden_scenarios: consultar docs/GOLDEN_SCENARIOS.md
acceptance_criteria: mock-first, executed:false, review humana
rollback_plan: voltar para draft e remover da lista proposta
owner_human: humano ficticio
created_from_pattern: padrao de compras
notes: apenas contrato documental
```

## Como usar

Antes de promover qualquer skill candidata:

1. revisar o domínio
2. revisar a Permission Matrix
3. revisar Golden Scenarios
4. validar mock adapter
5. validar `executed:false`
6. validar forbidden fields
7. obter revisão humana

## Observações finais

- Skills candidatas não alteram runtime nesta PR.
- Skills candidatas não habilitam execução real.
- Skills candidatas continuam mock-first.

## Memory Policy

Se um padrão de tarefa recorrente depender de contexto persistido no futuro,
consulte `docs/MEMORY_POLICY.md`. A política de memória não cria execução real
nem storage real; ela apenas orienta limites, isolamento e campos proibidos.

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` can surface skill candidate risk and missing
contract references. It does not approve a skill and does not change the draft,
mock-first or `executed:false` rules.

## External Integration Provider Registry

Skill candidates that mention a future provider must point to
`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`. A provider reference does not
turn a skill into an executable automation and does not allow real provider
calls.

## Integration Security Boundary

Skill candidates that mention future integrations must respect
`docs/INTEGRATION_SECURITY_BOUNDARY.md`. A skill candidate cannot approve OAuth,
secrets, provider calls, writes, cross-tenant access or `executed:true`.

## External Provider Permission Overlay

Skill candidates that depend on a future external provider must reference
`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`. The overlay cannot turn a skill
candidate into an executable provider automation.

## External Provider Mock Adapter Harness

Skill candidates that mention provider behavior can reference
`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` for synthetic mock examples.
The harness cannot turn a skill candidate into an executable integration.

## External Provider Audit, Cost and Rate Limit

Skill candidates that mention provider cost, usage or fallback must reference
`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`. Cost/rate signals cannot
promote a skill or authorize provider execution.
