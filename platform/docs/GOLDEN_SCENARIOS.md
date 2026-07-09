# Hermes Core Golden Scenarios

Lista oficial de cenários dourados para validar comportamento esperado por
domínio antes de criar adapters reais. Os cenários abaixo são contratuais e
não habilitam execução real.

## Cenários por domínio

### Compras

- Usuário pede para registrar compra de fornecedor com valor e prazos.
- Esperado:
  - `domain = compras`
  - `intent` relacionada a compra
  - `confirmation_required = true`
  - `adapter_id = mock-compras` após confirmação positiva
  - `simulated = true`
  - `executed = false`

### Financeiro

- Usuário pede análise ou consulta financeira.
- Esperado:
  - `domain = financeiro`
  - `confirmation_required = true` quando envolver ação sensível
  - `adapter_id = mock-financeiro` se aprovado
  - `simulated = true`
  - `executed = false`
  - dados sensíveis não são expostos

### Treinamento

- Usuário pede criação ou sugestão de módulo de treinamento.
- Esperado:
  - `domain = treinamento`
  - `adapter_id = mock-treinamento`
  - `simulated = true`
  - `executed = false`

### Marketing

- Usuário pede ideia, campanha ou conteúdo.
- Esperado:
  - `domain = marketing`
  - `adapter_id = mock-marketing`
  - `simulated = true`
  - `executed = false`

### Desenvolvimento

- Usuário pede tarefa técnica, PR ou plano de código.
- Esperado:
  - `domain = desenvolvimento`
  - `adapter_id = mock-desenvolvimento`
  - `simulated = true`
  - `executed = false`

## Cenários negativos

- Mensagem ambígua não deve executar.
- Confirmação com "não" não deve rodar mock adapter.
- Confirmação ambígua não deve rodar mock adapter.
- `confirmation_id` inexistente deve retornar `not_found` seguro.
- Domínio desconhecido não deve executar.
- Qualquer response não deve conter:
  - `requiredAdapters`
  - `payload` interno
  - `rawMessage`
  - `userMessage`
  - `secrets`
  - `tokens`
  - `env`
  - `headers`
  - `cookies`
  - `credentials`

## Regras obrigatórias

- `executed:false` continua obrigatório.
- mock first.
- human confirmation.
- no secrets.
- no raw payload.
- CI/smoke obrigatório.

Antes de registrar novos cenários, siga `docs/DOMAIN_ONBOARDING.md` para
garantir consistência com Permission Matrix, mock adapter e review humana.

Se o cenário representar um padrão reutilizável de tarefa, registre também o
alvo em `docs/SKILL_CANDIDATE_REGISTRY.md` sem alterar runtime.

Se o cenário exigir contexto persistido no futuro, consulte
`docs/MEMORY_POLICY.md` para manter isolamento, thresholds e campos proibidos
sem implementar memória real nesta PR.

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` treats these scenarios as a critical check
area. Governance can flag missing or regressed scenarios, but it does not
substitute for them and does not authorize real execution.

## External Integration Provider Registry

If a golden scenario depends on a future external provider, the provider must be
documented in `docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` first. Provider
registry entries do not call APIs, do not create adapters and do not authorize
real execution.

## Integration Security Boundary

Provider-related scenarios must also respect
`docs/INTEGRATION_SECURITY_BOUNDARY.md`. A scenario cannot include raw payloads,
secrets, cross-tenant leakage, real writes or `executed:true`.
