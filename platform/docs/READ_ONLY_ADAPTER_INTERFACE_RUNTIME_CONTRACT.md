# Read-Only Adapter Interface and Runtime Contract

## What This Contract Is

The Read-Only Adapter Interface and Runtime Contract defines the first stable
shape for future real read-only adapters in Hermes Core.

It is an interface contract and a deterministic runtime planning contract. It
does not register an adapter, does not call a provider, does not read secrets,
does not enable OAuth, and does not change `/message` or `/confirm`.

This document is retained as the compatibility contract for the initial
interface work. The executable v2 boundary is
`READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md`, which adds an isolated registry and a
runtime that can execute only local mock/test-double adapters.

The runtime keeps real adapters and provider calls blocked:

- `simulated:true`
- `executed:false` for real candidates
- `real_provider_called:false`
- `can_trigger_real_execution:false`
- `write_allowed:false`
- `action_allowed:false`
- `send_allowed:false`
- `publish_allowed:false`
- `delete_allowed:false`

Local mock adapters may return `executed:true` only to indicate local
test-double execution. That never means a provider was called.

## Goals

- Define the minimum descriptor for a future read-only adapter.
- Define the minimum sanitized request and response contracts.
- Define a pure runtime plan that can be tested without network, database,
  filesystem runtime reads, OAuth, secrets, or provider calls.
- Keep the readiness gate as a prerequisite for any future real read-only PR.
- Keep the runtime fail-closed and deny-by-default.
- Prevent write/action/send/publish/delete operations at the interface layer.
- Prevent forbidden fields from entering descriptors, requests, or responses.
- Make future runtime wiring explicit and auditable before any real adapter is
  invoked.

## Non-Goals

This PR does not:

- implement a real adapter
- register a real provider
- call Firecrawl, AssemblyAI, Google, GitHub, Supabase, Base44, ERP, or any
  external provider
- create OAuth
- create token or secret storage
- create database queries
- create storage, cache, queue, RAG, or scheduler
- alter `/message`
- alter `/confirm`
- allow `executed:true`
- allow `real_provider_called:true`
- allow real write/action/send/publish/delete

## Official Interface Statuses

- `interface_not_evaluated`
- `interface_valid`
- `interface_invalid`
- `runtime_plan_created`
- `runtime_blocked`
- `runtime_error_safe`

No status authorizes real execution.

## Official Runtime Modes

- `disabled`
- `contract_only`
- `mock_only`
- `read_only_candidate`
- `readiness_required`
- `blocked_by_readiness`
- `blocked_by_runtime_policy`
- `blocked_by_input_contract`
- `safe_runtime_plan`

All modes are non-executing in this PR.

## Provider Classes

- `public_web`
- `transcription`
- `internal_business_api`
- `personal_connector`
- `corporate_connector`
- `external_client_connector`
- `development_connector`
- `other_read_only`

Provider class selection does not register a provider and does not imply
credential readiness.

## Adapter Descriptor Fields

Minimum descriptor fields:

- `adapter_id`
- `provider_id`
- `provider_type`
- `provider_class`
- `runtime_mode`
- `workspace_types`
- `tenant_strategy`
- `domains`
- `capabilities`
- `operations`
- `output_contract`
- `error_contract`

Rules:

- arrays must be non-empty arrays of strings
- operations must be read-only or draft-only candidates
- write-like operations are blocked structurally
- tenant strategy must be declared
- output and error contracts must be explicit
- forbidden fields are blocked recursively

## Request Fields

Minimum request fields:

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `adapter_id`
- `provider_id`
- `provider_class`
- `domain`
- `capability`
- `operation`
- `sanitized_input`
- `simulated`
- `executed`
- `real_provider_called`

Rules:

- `simulated` must be `true`
- `executed` must be `false`
- `real_provider_called` must be `false`
- `sanitized_input` must not contain raw payload, raw message, secrets, tokens,
  headers, cookies, credentials, or private URLs
- evidence does not replace structural validation

## Response Fields

Minimum response fields:

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `adapter_id`
- `provider_id`
- `provider_class`
- `domain`
- `capability`
- `operation`
- `status`
- `safe_summary`
- `sanitized_output`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`

Rules:

- `simulated:true`
- `executed:false`
- `real_provider_called:false`
- `can_trigger_real_execution:false`
- response output must be sanitized and bounded
- response output must not include raw payload or sensitive data

## Allowed Operation Shapes

- `read_summary`
- `read_metadata`
- `list_summary`
- `get_summary`
- `aggregate_summary`
- `search_summary`
- `draft_candidate`
- `safe_fixture_response`

Draft candidate means future draft output only. It is not an action.

## Blocked Operation Terms

Any operation containing one of these terms is blocked:

- `create`
- `update`
- `delete`
- `write`
- `send`
- `publish`
- `merge`
- `approve`
- `reject`
- `payment`
- `purchase`
- `insert`
- `upsert`
- `execute`
- `upload`
- `share`
- `modify`
- `cancel`

The check is intentionally conservative.

## Forbidden Fields

Forbidden fields are blocked recursively:

- `token`
- `secret`
- `env`
- `headers`
- `cookies`
- `credentials`
- `payload`
- `rawPayload`
- `rawMessage`
- `userMessage`
- `requiredAdapters`
- `authorization`
- `password`
- `stackTrace`
- `apiKey`
- `accessToken`
- `refreshToken`
- `requestBody`
- `responseBody`
- `rawSql`
- `rawQuery`
- `rawDatabasePayload`
- `rawSocialPayload`
- `rawTranscript`
- `rawAudio`
- `privateUrl`
- `webhookSecret`

Only the field name may appear in a blocking reason. Values must never be
copied to the result.

## Runtime Planning Rules

The runtime planner is pure and deterministic. It:

- validates the adapter descriptor
- validates the request
- requires readiness status `ready_for_real_read_only_pr`
- returns a JSON-serializable plan
- never invokes an adapter
- never calls a provider
- never reads env vars
- never reads secrets
- never logs raw input
- never returns `execution_allowed:true`

`safe_runtime_plan` means the interface and request are structurally valid and
the readiness gate says a future read-only PR may be proposed. It does not mean
runtime execution is enabled.

## Relationship With Readiness Gate

`REAL_READ_ONLY_ADAPTER_READINESS_GATE.md` remains mandatory before any future
real read-only adapter PR. This contract consumes the readiness verdict as an
input but does not replace it.

READY in the readiness gate still means only eligibility for a future PR. This
interface contract still returns:

- `execution_allowed:false`
- `adapter_invocation_allowed:false`
- `real_provider_calls_allowed:false`
- `can_trigger_real_execution:false`

## Relationship With Existing Contracts

This contract depends on:

- `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`
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
- `GOVERNANCE_CHECK_REPORT.md`
- `PERMISSION_MATRIX.md`
- `OPERATOR_RUNBOOK.md`

## Future Sequence

1. contract and sandbox exist
2. provider candidate exists
3. mock adapter and fixture exist
4. readiness gate returns eligible for future PR
5. read-only adapter interface validates descriptor and request
6. human review
7. governance review
8. future adapter PR with feature flag default off
9. non-production rollout
10. canary
11. observability
12. kill switch verified

This PR stops at step 5 and still performs no real execution.
