# Public Web Canary Operational Trial

## Objetivo

Este contrato define o pacote operacional para executar o primeiro ensaio manual do Public Web Read-Only Adapter em `development` ou `staging`. O trial e escopado a uma origem publica especifica, um path especifico, um tenant, um workspace, um usuario, um operador, um aprovador, uma sessao e uma chamada inicial.

O merge desta PR nao executa o trial, nao ativa producao, nao registra endpoint, nao cria scheduler e nao integra o adapter a `/message` ou `/confirm`.

## Activation vs Operational Trial

Public Web Non-Production Canary Activation entrega contratos de sessao, approval, runner, DNS seguro, HTTPS client, audit e report.

Public Web Canary Operational Trial entrega plano especifico, configuracao local nao sensivel, preflight, dry-run obrigatorio, confirmacao interativa, autorizacao efemera, evidencias, decisao go/no-go e cleanup.

## Trial States

- not_started
- configuration_pending
- preflight_pending
- preflight_blocked
- preflight_passed
- dry_run_pending
- dry_run_blocked
- dry_run_passed
- operator_confirmation_pending
- execution_reserved
- execution_started
- execution_succeeded
- execution_failed_safe
- report_pending
- report_completed
- decision_pending
- eligible_for_second_trial
- remediation_required
- terminated
- cancelled
- expired

## Results

- trial_success
- trial_failed_safe
- trial_blocked_preflight
- trial_blocked_dry_run
- trial_cancelled
- trial_expired
- trial_kill_switch_terminated

## Go/No-Go

Decisoes permitidas:

- remain_disabled
- remediation_required
- eligible_for_second_trial
- terminate_candidate

Decisoes proibidas:

- production_approved
- runtime_enabled
- unrestricted_rollout
- automatic_activation

## Local Configuration

O template seguro fica em `platform/services/api/config/public-web-canary-trial.example.json`. Ele contem apenas campos nao sensiveis e usa `example.com` como placeholder bloqueado. A execucao real exige um arquivo local criado manualmente e ignorado pelo Git.

Arquivos locais ignorados:

- public-web-canary-trial.local.json
- public-web-canary-trial.result.json
- public-web-canary-trial.evidence.json
- public-web-canary-trial.approval.json

## Preflight

O preflight nunca chama rede. Ele valida plano, ambiente, feature flag explicita, kill switch inativo, adapter registrado, lifecycle elegivel, configuracao `structurally_ready`, readiness atual, secret reference ativa, target policy, allowlists de tenant/workspace/user, operador, aprovador, budgets, audit sink, DNS resolver e runner/cliente disponivel.

## Dry-Run

O dry-run usa apenas fakes. Ele deve passar pelo fluxo de runner com DNS/HTTPS sinteticos, validar replay protection, kill switch, producao bloqueada, audit e report. O resultado esperado e `executed:true`, `real_provider_called:false`, `simulated:true` e exatamente uma chamada fake.

## Manual Execution

A execucao operacional deve ser chamada explicitamente:

```bash
npm run trial:public-web -- --config ./config/public-web-canary-trial.local.json
```

Antes da chamada real o operador precisa digitar exatamente:

```text
EXECUTAR CANARY PUBLIC WEB
```

`--force`, `--yes`, `--skip-preflight`, `--skip-dry-run`, `--production`, `--url`, `--target`, `--token`, `--secret`, `--header` e `--cookie` sao bloqueados.

## Evidence

O evidence bundle contem hashes, IDs de trial/sessao/execucao, status, flags de execucao, bytes, duracao, classe HTTP, contagem de audit e erro seguro. Ele nunca contem URL completa, query, HTML, body, headers, cookies, IP, secret reference, secret handle, token, approval raw object ou stack trace.

## Cleanup

Cleanup e obrigatorio em `finally`: desativa/revoga target policy do trial, cancela sessao nao terminal, invalida autorizacao, libera budget de concorrencia, confirma kill switch disponivel e preserva apenas evidencia sanitizada. Cleanup parcial forca `remediation_required`.

## Default State After Merge

- feature flag off
- rollout 0
- trial not started
- canary inactive
- production blocked
- target trial disabled
- no automatic execution
- no endpoint
- no scheduler
- no provider call
- no secret included
- no external request in CI

## Contract References

- PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md
- PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md
- REAL_PROVIDER_CONFIGURATION_BOUNDARY.md
- CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md
- EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md
- TENANT_WORKSPACE_ISOLATION.md
- GOVERNANCE_CHECK_REPORT.md
- PERMISSION_MATRIX.md
