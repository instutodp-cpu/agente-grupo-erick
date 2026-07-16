# Read-Only Adapter Interface and Runtime

## Objective

This contract defines the common interface, request envelope, response envelope
and isolated runtime for future read-only adapters in Hermes Core. It prevents
ad hoc adapters, normalizes safe errors and audit metadata, preserves tenant and
workspace isolation, and blocks bypasses of the readiness gate.

This PR does not activate a provider, does not call a network service, does not
create OAuth, does not read secrets and does not change `/message` or
`/confirm`. Only local mock/test-double adapters can execute in this PR.

## Principles

- single adapter interface
- fail-closed
- deny-by-default
- read-only first
- no-write guarantee
- tenant scoped
- workspace scoped
- provider scoped
- capability scoped
- timeout required
- retry disabled or bounded
- sanitized input and output
- deterministic result envelope
- audit event candidate required
- feature flag default off
- kill switch required
- readiness required before any future real adapter

## Adapter Lifecycle Statuses

- `unregistered`
- `registered_mock`
- `registered_candidate`
- `readiness_blocked`
- `readiness_passed`
- `runtime_disabled`
- `runtime_mock_only`
- `runtime_read_only_candidate`
- `deprecated`
- `blocked`

No lifecycle status activates a real provider in this PR. `readiness_passed`
means only eligible for future integration work. `runtime_mock_only` is the only
executable mode in this PR.

## Adapter Kinds

- `mock`
- `real_read_only_candidate`
- `real_read_only`
- `draft_only`
- `blocked`

Only `mock` can execute in this PR. `real_read_only_candidate` can be
registered, validated and blocked, but it cannot execute. `real_read_only` is
rejected by registry validation in this PR. `draft_only` cannot send or publish.
`blocked` never executes.

## Minimum Adapter Interface

Each adapter exposes the equivalent of:

```json
{
  "metadata": {},
  "validateRequest": "function",
  "execute": "function",
  "sanitizeResponse": "function",
  "buildAuditEvent": "function"
}
```

Required metadata:

- `adapter_id`
- `provider_id`
- `provider_type`
- `adapter_kind`
- `version`
- `supported_workspace_types`
- `supported_domains`
- `supported_capabilities`
- `supported_operations`
- `readiness_candidate_id`
- `feature_flag_key`
- `timeout_ms`
- `retry_policy`
- `cost_risk`
- `rate_limit_risk`
- `data_classification`
- `deprecated`
- `enabled`
- `tenant_strategy`

Metadata is treated as immutable during runtime. `adapter_id` is unique.
`timeout_ms` must be positive and bounded. `retry_policy` must be safe.
`supported_operations` must be read-only. Real candidates must remain disabled.

## Request Envelope

Required request fields:

- `trace_id`
- `request_id`
- `adapter_id`
- `provider_id`
- `provider_class`
- `workspace_type`
- `tenant_id`
- `user_id`
- `role`
- `company_id`
- `store_id`
- `client_id`
- `domain`
- `capability`
- `operation`
- `input`
- `input_classification`
- `requested_at`
- `simulated`
- `executed`
- `real_provider_called`
- `write_allowed`
- `action_allowed`
- `send_allowed`
- `publish_allowed`
- `delete_allowed`

`input` must be sanitized. `tenant_id` cannot be derived from prompt text and
the adapter cannot alter tenant identity. Write/action/send/publish/delete flags
must be false. `simulated:true`, `executed:false` before runtime and
`real_provider_called:false` are mandatory.

## Response Envelope

Runtime returns:

- `trace_id`
- `request_id`
- `adapter_id`
- `provider_id`
- `status`
- `adapter_kind`
- `workspace_type`
- `tenant_id`
- `domain`
- `capability`
- `operation`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `data`
- `safe_summary`
- `warnings`
- `error`
- `duration_ms`
- `audit_event_candidate`

The envelope is JSON-serializable and sanitized. A local mock may return
`executed:true` only to indicate local test-double execution. Even then,
`simulated:true`, `real_provider_called:false` and
`can_trigger_real_execution:false` remain fixed.

## Execution Statuses

- `adapter_mock_success`
- `adapter_mock_blocked`
- `adapter_mock_error_safe`
- `adapter_validation_failed`
- `adapter_not_registered`
- `adapter_disabled`
- `adapter_kind_not_allowed`
- `adapter_readiness_required`
- `adapter_feature_flag_off`
- `adapter_kill_switch_active`
- `adapter_workspace_blocked`
- `adapter_tenant_blocked`
- `adapter_permission_blocked`
- `adapter_operation_blocked`
- `adapter_timeout`
- `adapter_contract_violation`
- `adapter_internal_error_safe`

## Error Codes

- `INVALID_ADAPTER_REQUEST`
- `ADAPTER_NOT_REGISTERED`
- `ADAPTER_DISABLED`
- `ADAPTER_KIND_NOT_ALLOWED`
- `READINESS_REQUIRED`
- `FEATURE_FLAG_OFF`
- `KILL_SWITCH_ACTIVE`
- `WORKSPACE_NOT_ALLOWED`
- `TENANT_SCOPE_INVALID`
- `CAPABILITY_NOT_SUPPORTED`
- `OPERATION_NOT_SUPPORTED`
- `WRITE_OPERATION_BLOCKED`
- `FORBIDDEN_FIELD_DETECTED`
- `ADAPTER_TIMEOUT`
- `INVALID_ADAPTER_RESPONSE`
- `UNSAFE_ADAPTER_RESPONSE`
- `INTERNAL_ADAPTER_ERROR`

## Allowed Operations

Allowed read-only prefixes:

- `get`
- `list`
- `search`
- `read`
- `summarize`
- `inspect`
- `lookup`
- `compare`
- `analyze`
- `fetch_metadata`
- `generate_summary`
- `generate_draft_candidate`
- `health_check_mock`

## Blocked Operations

Any operation containing these terms is blocked:

- `create`
- `update`
- `delete`
- `insert`
- `upsert`
- `write`
- `send`
- `publish`
- `merge`
- `approve`
- `reject`
- `pay`
- `payment`
- `purchase`
- `cancel`
- `upload`
- `share`
- `modify`
- `execute`
- `commit`
- `push`
- `close`
- `archive`
- `invite`
- `provision`
- `deploy`

## Forbidden Fields

These keys are blocked recursively in metadata, requests and responses:

- `token`
- `secret`
- `env`
- `headers`
- `cookies`
- `credentials`
- `authorization`
- `password`
- `apiKey`
- `accessToken`
- `refreshToken`
- `rawPayload`
- `rawMessage`
- `userMessage`
- `requestBody`
- `responseBody`
- `rawSql`
- `rawQuery`
- `rawDatabasePayload`
- `rawSocialPayload`
- `rawTranscript`
- `rawAudio`
- `privateUrl`
- `stackTrace`
- `webhookSecret`

Values for forbidden fields are never returned.

## Runtime Pipeline

The runtime pipeline is:

1. validate adapter registration
2. validate request envelope
3. validate forbidden fields
4. validate workspace
5. validate tenant
6. validate capability
7. validate operation
8. validate adapter kind
9. validate feature flag
10. validate kill switch
11. validate readiness state
12. execute mock adapter
13. validate response
14. sanitize response
15. build audit event candidate
16. return envelope

Any failure stops the pipeline and returns a safe envelope. The runtime does not
log raw input and does not copy the full request into the response.

## Readiness Relationship

Future real adapters require `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`.
Readiness evidence must include matching `candidate_id`, `provider_id` and
`adapter_id`, allow verdict, safe flags and empty blocking arrays. In this PR,
readiness never triggers execution. Real candidates still return
`READINESS_REQUIRED`, `FEATURE_FLAG_OFF` or `ADAPTER_KIND_NOT_ALLOWED`.

## Registry Relationship

The registry stores known adapters by `adapter_id`. Unknown adapters block.
Duplicate adapters block. Invalid metadata blocks. Registry returns defensive
copies and does not expose mutable internal references.

## Tenant Strategies

- `tenant_id_required`: `tenant_id` must be non-empty
- `personal_user_tenant`: `tenant_id` must equal `personal::<user_id>`
- `corporate_grupo_erick`: `tenant_id` must equal `grupo_erick`
- `external_client_tenant`: `client_id` is required and `tenant_id` must equal `client::<client_id>`

Provider, request input and prompt text cannot override tenant identity.

## Timeout And Retry

Timeout is mandatory and capped. Real retries are disabled. Mock retries are
bounded. A timeout returns `adapter_timeout` and `ADAPTER_TIMEOUT` without stack
trace or raw payload exposure.

## Audit

Every response includes `audit_event_candidate` with:

- `event_name`
- `trace_id`
- `request_id`
- `adapter_id`
- `provider_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `domain`
- `capability`
- `operation`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `duration_ms`
- `error_code`
- `blocked_reason`

Audit must never include raw input, raw output, token, secret, headers, cookies
or payload.

## Relationship With Existing Contracts

- `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`
- `CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md`
- `REAL_PROVIDER_CONFIGURATION_BOUNDARY.md`
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`
- `INTEGRATION_SECURITY_BOUNDARY.md`
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`
- `TENANT_WORKSPACE_ISOLATION.md`
- `PERMISSION_MATRIX.md`
- `GOVERNANCE_CHECK_REPORT.md`
- `OPERATOR_RUNBOOK.md`
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`
- `TRANSCRIPTION_INTAKE_SANDBOX.md`
- `INTERNAL_BUSINESS_API_READ_ONLY.md`
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`
- `CORPORATE_WORKSPACE_CONNECTOR_POLICY.md`
- `EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md`

## Connector Lifecycle Relationship

`CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md` controls lifecycle state, version,
rollout stage, readiness binding, feature flag default-off policy and kill
switch policy for connector records. It does not replace this adapter
interface/runtime contract and does not activate real adapters. `mock_only`
remains the maximum reachable lifecycle state in PR #61.

## Provider Configuration Boundary Relationship

`REAL_PROVIDER_CONFIGURATION_BOUNDARY.md` defines future provider configuration,
secret references, rotation and expiration metadata and sanitized configuration
audit candidates. This adapter runtime does not read provider credentials,
does not use provider SDKs and does not call providers. Real candidates remain
blocked until a future PR explicitly binds lifecycle, readiness, configuration,
feature flag, kill switch and provider execution policy.

## Public Web Read-Only Adapter Pilot Relationship

`PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md` defines the first concrete
`real_read_only_candidate` adapter built on this interface. The adapter can be
registered explicitly in pilot tests, but the existing runtime still blocks
non-mock execution. The pilot adds transport contracts and gate checks without
importing the adapter into `src/index.js` or changing `/message` and
`/confirm`.

## Public Web Non-Production Canary Activation Relationship

`PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md` adds a separate manual runner
for development/staging canaries. It does not import the runner into the main
runtime and does not change the mock-only runtime ceiling or endpoint behavior.
