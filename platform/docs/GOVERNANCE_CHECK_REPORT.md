# Hermes Core Governance Check Report

Contrato oficial do relatório de governanca do Hermes Core. Esta fase existe
apenas para documentar como o core sera verificado no futuro; nao implementa
scanner real, auditoria automatica real, CI gate novo obrigatorio ou qualquer
mudanca de runtime.

## O que e

O Governance Check Report e um relatorio futuro para revisar saude, seguranca e
consistencia do Hermes Core antes de evolucoes sensiveis. Ele pode avaliar:

- Permission Matrix
- Golden Scenarios
- Domain Onboarding
- Capability Registry
- Confirmation Gate
- Execution Policy
- Kill Switch
- Mock Adapters
- Adapter Result Contract
- Adapter Audit Event Contract
- Skill Candidate Registry
- Memory Policy
- User / Peer Memory Scopes
- Second Brain Inbox
- Quality Score + Feedback Loop
- External Integration Provider Registry
- Integration Security Boundary
- Forbidden Fields
- Operator Runbook
- Runtime Safety

Nesta PR o contrato e apenas documental. Nao executa acoes, nao altera runtime,
nao autoriza `executed:true` e nao habilita execucao real.

## Objetivos

- Detectar riscos antes de evolucoes sensiveis.
- Verificar consistencia dos contratos publicos.
- Verificar se regras de seguranca nao foram removidas por acidente.
- Verificar se novos dominios respeitam Domain Onboarding.
- Verificar se capabilities respeitam Permission Matrix.
- Verificar se Golden Scenarios cobrem fluxos criticos.
- Verificar se adapters continuam mock-first.
- Verificar se forbidden fields nao aparecem em docs, fixtures, logs ou
  responses.
- Verificar se o kill switch continua documentado.
- Verificar se `executed:false` continua obrigatorio.

## Areas oficiais de checagem

### permission_matrix

- risk_level: high
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### golden_scenarios

- risk_level: high
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### domain_onboarding

- risk_level: high
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### capability_registry

- risk_level: high
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### confirmation_gate

- risk_level: critical
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### execution_policy

- risk_level: critical
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### kill_switch

- risk_level: critical
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### mock_adapters

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### adapter_result_contract

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### adapter_audit_event_contract

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### skill_candidate_registry

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### memory_policy

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### user_peer_memory_scopes

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### second_brain_inbox

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### quality_score_feedback_loop

- risk_level: medium
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### external_integration_provider_registry

- risk_level: high
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### integration_security_boundary

- risk_level: critical
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### forbidden_fields

- risk_level: critical
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### operator_runbook

- risk_level: high
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

### runtime_safety

- risk_level: critical
- required_for_sensitive_changes: true
- can_block_release: true
- can_trigger_real_execution: false

## Status oficiais

- `pass`
- `warning`
- `blocked`
- `not_applicable`
- `needs_human_review`

Regras:

- `blocked` impede avancar em PR sensivel.
- `warning` exige comentario ou plano de follow-up.
- `needs_human_review` exige revisao humana.
- `pass` nao autoriza execucao real.
- nenhum status autoriza `executed:true`.

## Severidades oficiais

- `low`
- `medium`
- `high`
- `critical`

Regras:

- `high` e `critical` exigem revisao humana.
- `critical` deve bloquear evolucao sensivel.
- qualquer achado com `secret`, `token`, `env` ou `credentials` e
  `critical`.
- qualquer achado com `executed:true` nesta fase e `critical`.
- qualquer remocao de confirmation gate ou kill switch e `critical`.

## Campos minimos do report

- `report_id`
- `generated_at`
- `report_type`
- `target_scope`
- `target_branch`
- `target_pr`
- `overall_status`
- `check_areas`
- `findings`
- `blocked_reasons`
- `warnings`
- `human_review_required`
- `can_trigger_real_execution`
- `executed`
- `runtime_changed`
- `storage_changed`
- `external_services_added`
- `forbidden_fields_detected`
- `recommended_next_steps`
- `reviewer_notes`

Regras obrigatorias:

- `can_trigger_real_execution = false`
- `executed = false`
- `runtime_changed = false`
- `storage_changed = false`
- `external_services_added = false`
- `forbidden_fields_detected = true` bloqueia avance
- nao incluir secret, token, env, payload interno ou mensagem crua

## Achados oficiais

- `missing_contract_reference`
- `forbidden_field_detected`
- `unsafe_runtime_change`
- `missing_confirmation_gate`
- `missing_kill_switch_reference`
- `missing_permission_matrix_entry`
- `missing_golden_scenario`
- `missing_domain_onboarding`
- `adapter_not_mock_first`
- `executed_true_detected`
- `storage_added_without_contract`
- `external_service_added_without_contract`
- `sensitive_log_risk`
- `docs_regression`
- `fixture_regression`
- `test_gap`
- `duplicate_doc_section`

Cada achado deve indicar:

- `severity`
- `area`
- `description`
- `blocks_sensitive_change`
- `requires_human_review`
- `can_trigger_real_execution: false`

## Bloqueios obrigatorios

Devem bloquear qualquer evolucao sensivel:

- `executed:true` detectado nesta fase
- adapter real sem PR especifica aprovada
- storage real sem contrato e revisao
- RAG/vector database sem contrato e revisao
- LLM scoring real sem contrato e revisao
- secrets/token/env/credentials em docs, fixtures ou logs
- remocao de confirmation gate
- remocao de kill switch
- remocao de Permission Matrix
- remocao de Golden Scenarios
- remocao de forbidden fields
- vazamento entre tenant, usuario ou dominio
- qualquer mudanca que execute acao real

## Relacao com outros contratos

- Quality Score + Feedback Loop pode alimentar este relatorio no futuro, mas
  nao substitui governanca.
- Integration Security Boundary define os limites que qualquer provider futuro
  deve respeitar antes de mock, sandbox ou adapter.
- Second Brain Inbox pode gerar itens de auditoria no futuro, mas nao grava
  memoria real nesta PR.
- Memory Policy e User / Peer Memory Scopes continuam obrigatorios para
  qualquer memoria futura.
- Skill Candidate Registry continua em draft, mock-first e com revisao humana.
- Permission Matrix e Golden Scenarios continuam como base de expansao por
  dominio.

## Seguranca e LGPD

- Nao guardar `rawMessage`.
- Nao guardar `payload` interno.
- Nao guardar `secret`.
- Nao guardar `stack trace` completo.
- Nao guardar `token`, `env`, `headers`, `cookies` ou `credentials`.
- Nao guardar `request body` completo.
- Relatorios devem ser sanitizados antes de qualquer uso futuro.
- Achados sensiveis exigem revisao humana.
- Minimizar dados e manter retencao limitada.

## Status desta PR

Este contrato documenta como o Governance Check Report deve funcionar no
futuro. Ele nao implementa scanner real, nao cria CI gate novo e nao altera o
runtime.
