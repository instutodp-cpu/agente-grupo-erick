# Real Read-Only Adapter Readiness Gate

## A. What The Readiness Gate Is

The Real Read-Only Adapter Readiness Gate is a mandatory decision gate before any real adapter can be proposed for Hermes Core. It evaluates explicit evidence and requirements for a future read-only integration.

The gate does not call a provider, test real credentials, activate an integration, replace human review, replace PR approval, replace feature flags, replace the kill switch, or replace observability. It only decides whether a candidate is eligible for a future real read-only adapter PR.

`READY` in this contract means only that a future PR may be proposed. It does not mean a provider is active, a credential exists, OAuth is configured, runtime registration happened, a feature flag is on, `executed:true` is allowed, or `real_provider_called:true` is allowed.

## B. Principles

- deny-by-default
- fail-closed
- explicit evidence
- additive-only custom contracts
- read-only first
- mock-first
- tenant isolation
- least privilege
- sanitized input and output
- auditability
- bounded cost
- bounded rate
- timeout required
- real retry disabled by default
- progressive rollout
- rollback and kill switch required

Custom contracts are additive-only. They can add mandatory requirements,
provider-specific requirements, and blocking conditions, but they can never
remove base requirements, remove base blocking conditions, weaken verdicts, or
change fixed safety flags.

## C. Official Readiness Statuses

- `not_evaluated`
- `blocked`
- `conditionally_ready`
- `ready_for_real_read_only_pr`
- `deprecated`
- `invalid_candidate`

Only `ready_for_real_read_only_pr` indicates that a future real read-only adapter PR may be proposed. No status executes an adapter, changes `executed:false`, or changes `real_provider_called:false`. `conditionally_ready` remains blocked for real providers. Any unknown mandatory requirement returns `blocked`.

## D. Official Verdict

- `allow_future_read_only_pr`
- `deny_future_read_only_pr`

The default verdict is `deny_future_read_only_pr`. Only `ready_for_real_read_only_pr` can produce `allow_future_read_only_pr`. In this PR, allow does not execute anything, change a feature flag, register a provider, or access a secret.

## E. Requirement Categories

- `identity_scope`
- `tenant_workspace`
- `provider_registry`
- `capability_registry`
- `permission_matrix`
- `permission_overlay`
- `security_boundary`
- `governance`
- `human_review`
- `mock_parity`
- `fixture_coverage`
- `contract_tests`
- `golden_scenarios`
- `audit`
- `logging_sanitization`
- `secret_management_plan`
- `oauth_scope_plan`
- `cost_controls`
- `rate_limit_controls`
- `timeout_controls`
- `retry_policy`
- `kill_switch`
- `feature_flag`
- `rollout_plan`
- `rollback_plan`
- `incident_runbook`
- `data_minimization`
- `retention_policy`
- `lgpd_review`
- `observability`
- `error_contract`
- `tenant_isolation_tests`
- `no_write_guarantee`
- `provider_specific_readiness`

## F. Mandatory Blocking Requirements

All mandatory requirements must be explicitly satisfied:

- `candidate_id_present`
- `provider_id_present`
- `adapter_id_present`
- `workspace_types_declared`
- `tenant_strategy_declared`
- `domains_declared`
- `capabilities_declared`
- `operations_declared`
- `provider_registered`
- `provider_status_candidate`
- `read_only_only`
- `write_disabled`
- `action_disabled`
- `send_disabled`
- `publish_disabled`
- `delete_disabled`
- `mock_adapter_exists`
- `mock_parity_documented`
- `safe_fixture_exists`
- `contract_tests_exist`
- `permission_matrix_mapped`
- `permission_overlay_mapped`
- `security_boundary_mapped`
- `governance_review_completed`
- `human_review_owner_declared`
- `audit_events_declared`
- `logs_sanitized`
- `forbidden_fields_declared`
- `cost_risk_known`
- `rate_limit_risk_known`
- `timeout_defined`
- `retries_disabled_or_bounded`
- `kill_switch_defined`
- `feature_flag_defined`
- `feature_flag_default_off`
- `rollout_plan_defined`
- `rollback_plan_defined`
- `incident_runbook_defined`
- `data_minimization_defined`
- `retention_policy_defined`
- `lgpd_review_completed`
- `observability_defined`
- `safe_error_contract_defined`
- `tenant_isolation_tests_exist`
- `cross_tenant_tests_exist`
- `no_write_tests_exist`
- `no_real_call_in_test`
- `provider_specific_requirements_satisfied`

The base mandatory requirements are immutable. A custom contract can append
requirements to this list, but it cannot remove or override any base
requirement.

## G. Requirements That Can Never Be Accepted

The gate must immediately block:

- `write_allowed_true`
- `action_allowed_true`
- `send_allowed_true`
- `publish_allowed_true`
- `delete_allowed_true`
- `raw_sql_allowed`
- `writeback_allowed`
- `unrestricted_oauth_scope`
- `missing_tenant_scope`
- `prompt_controls_tenant`
- `provider_controls_tenant`
- `cross_tenant_access`
- `tokens_in_fixture`
- `tokens_in_logs`
- `tokens_in_memory`
- `raw_payload_logging`
- `raw_message_logging`
- `secrets_in_repository`
- `feature_flag_default_on`
- `kill_switch_missing`
- `timeout_missing`
- `unbounded_retry`
- `unknown_cost_risk`
- `unknown_rate_limit_risk`
- `real_call_in_contract_test`
- `production_rollout_without_canary`
- `executed_true_in_readiness`
- `real_provider_called_true_in_readiness`

The base immediate blockers are immutable. A custom contract can append more
blockers, but it cannot remove or override any base blocker. Unknown custom
blocking conditions fail closed and produce a blocked/deny result.

## H. Evidence Model

Each requirement receives:

- `requirement_id`
- `category`
- `required`
- `status`
- `evidence_refs`
- `notes`
- `reviewer`
- `reviewed_at`
- `blocking_reason`

Evidence statuses:

- `satisfied`
- `missing`
- `failed`
- `unknown`
- `not_applicable`

`required + not_applicable` can only be accepted when the requirement definition explicitly allows it. `required + missing`, `required + failed`, and `required + unknown` block. `evidence_refs` must use internal references and must never include tokens, private URLs, or secrets. Reviewer and `reviewed_at` can be synthetic placeholders in this phase.

Evidence never replaces structural validation. A candidate must still provide
valid identity fields, provider fields, workspace and tenant scope, domains,
capabilities, operations, mode, risk level, requester, and fixed safety booleans
before evidence is considered.

## I. Readiness Request

Minimum fields:

- `trace_id`
- `candidate_id`
- `provider_id`
- `adapter_id`
- `provider_type`
- `workspace_types`
- `tenant_strategy`
- `domains`
- `capabilities`
- `operations`
- `proposed_mode`
- `risk_level`
- `evidence`
- `requested_by`
- `simulated`
- `executed`
- `real_provider_called`

`proposed_mode` must be `real_read_only_candidate`. This PR requires `simulated:true`, `executed:false`, and `real_provider_called:false`. Operations cannot include write or action operations.

Candidate input is recursively checked for forbidden fields. If a key such as
`token`, `secret`, `accessToken`, `rawPayload`, `rawMessage`, `headers`,
`cookies`, `credentials`, `requestBody`, `responseBody`, `rawSql`, `rawAudio`,
`privateUrl`, or `webhookSecret` appears at any level, the gate returns
blocked/deny using only a sanitized blocker name such as
`forbidden_candidate_field::<field>`. The forbidden value is never copied to the
result and the raw candidate is never logged.

## J. Readiness Response

Minimum fields:

- `trace_id`
- `candidate_id`
- `provider_id`
- `adapter_id`
- `status`
- `verdict`
- `ready`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `evaluated_requirements`
- `satisfied_requirements`
- `blocking_requirements`
- `warning_requirements`
- `blocking_reasons`
- `next_steps`
- `audit_event_candidate`

The response always keeps `executed:false`, `real_provider_called:false`, and `can_trigger_real_execution:false` in this PR. `ready:true` is only valid with `ready_for_real_read_only_pr`. `allow_future_read_only_pr` is only valid with `ready:true`. Any missing mandatory requirement returns `ready:false`. Internal errors return `blocked`, never allow.

These fixed response flags cannot be changed by a custom contract:
`simulated:true`, `executed:false`, `real_provider_called:false`, and
`can_trigger_real_execution:false`.

## K. Provider Classes

- `public_web`
- `transcription`
- `internal_business_api`
- `personal_connector`
- `corporate_connector`
- `external_client_connector`
- `development_connector`
- `other_read_only`

Each provider class may add more requirements.

## L. First Possible Candidates

These are documented only and are not implemented or activated in this PR:

- `firecrawl_public_web_read_only`
- `assemblyai_transcription_sanitized`
- `internal_business_api_fixture_to_read_only`
- `github_read_only`
- `google_workspace_read_only`
- `supabase_read_only`
- `base44_read_only`

## M. Mandatory Future Sequence

1. Existing contract or sandbox
2. Provider registry candidate
3. Mock adapter and fixture
4. Readiness evaluation
5. Human review
6. Governance review
7. Specific real adapter PR
8. Feature flag default off
9. Non-production environment
10. Canary
11. Observability
12. Rollout approval

## N. Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`
- `INTEGRATION_SECURITY_BOUNDARY.md`
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`
- `TRANSCRIPTION_INTAKE_SANDBOX.md`
- `INTERNAL_BUSINESS_API_READ_ONLY.md`
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`
- `EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md`
- `CORPORATE_WORKSPACE_CONNECTOR_POLICY.md`
- `SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md`
- `READ_ONLY_ADAPTER_INTERFACE_RUNTIME_CONTRACT.md`
- `CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md`
- `REAL_PROVIDER_CONFIGURATION_BOUNDARY.md`
- `GOVERNANCE_CHECK_REPORT.md`
- `PERMISSION_MATRIX.md`
- `GOLDEN_SCENARIOS.md`
- `DOMAIN_ONBOARDING.md`
- `OPERATOR_RUNBOOK.md`

## Runtime Scope

This PR creates an executable gate, fixture, and tests only. It does not create a real adapter, call a provider, activate an integration, change `/message`, change `/confirm`, turn on a feature flag, add OAuth, add secrets, add storage, add database access, add network calls, or allow write/action/send/publish/delete. `READY` remains eligibility for a future PR only.

## Next Contract Boundary

`READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md` defines the next boundary after
readiness: adapter metadata, sanitized request/response envelopes, isolated
registry and mock-only runtime. It can execute only local test-double mocks.
Real candidates still require strong readiness evidence, feature flag default
off and kill switch checks, and they cannot call providers in this PR.

## Connector Lifecycle Relationship

`CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md` consumes readiness results only as
strongly-bound evidence for lifecycle transitions. A
`ready_for_real_read_only_pr` readiness result can move a lifecycle record to
`readiness_passed`, but it does not activate runtime, does not enable canary,
does not enable `read_only_active`, and does not allow real provider calls.

## Provider Configuration Boundary Relationship

`REAL_PROVIDER_CONFIGURATION_BOUNDARY.md` must be satisfied before any future
real provider can receive configuration. Readiness alone does not create
secrets, OAuth, SDK setup, provider calls or runtime activation. Configuration
must remain reference-only, feature-flagged, kill-switch protected and tenant
scoped.

## Public Web Read-Only Adapter Pilot Relationship

`PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md` consumes readiness evidence for
`public_web_read_only_candidate_v1`. Readiness can make the candidate eligible
for a future controlled PR only; the pilot gate still requires configuration,
lifecycle, feature flag, kill switch, canary, URL, DNS, IP, rate and cost
checks, and production remains blocked.

## Public Web Non-Production Canary Activation Relationship

`PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md` binds canary approval to a
readiness evidence hash. Readiness remains necessary but insufficient: target
allowlist, operator approval, feature flag, kill switch, budgets and audit are
still required before any development/staging canary request.
