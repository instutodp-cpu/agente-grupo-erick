# Real Provider Configuration Boundary

## A. Objetivo

Real Provider Configuration Boundary is the official contract for future provider configuration in Hermes Core. It defines how provider configuration records, secret references, readiness metadata, rotation metadata, expiration metadata, tenant policy, workspace policy and audit candidates must be represented before any real provider can be proposed in a future PR.

This PR does not implement providers. It does not create OAuth. It does not create secrets. It does not read runtime environment variables for provider credentials. It does not call APIs, add SDKs, persist storage, or connect the adapter runtime to any external service.

The boundary exists so future real read-only providers cannot be introduced with ad hoc configuration, raw credentials, unclear tenant ownership, missing rotation, missing expiration, or missing kill switch policy.

## B. Principles

- deny-by-default
- fail-closed
- secret references only
- no plaintext provider secret
- no runtime environment provider secret
- no OAuth in this phase
- no provider calls
- no SDK configuration
- private in-memory registry only
- defensive clones
- feature flag default off
- kill switch required
- tenant scope required
- workspace scope required
- rotation metadata required
- expiration metadata required
- sanitized audit candidate required
- `simulated:true`
- `executed:false`
- `real_provider_called:false`
- `can_trigger_real_execution:false`

## C. Provider Configuration Contract

A provider configuration record is a sanitized, non-secret descriptor for a future provider. It may reference a secret by opaque internal reference, but it must never contain the secret value.

Required fields:

- `configuration_id`
- `provider_id`
- `provider_type`
- `adapter_id`
- `connector_id`
- `workspace_type`
- `tenant_id`
- `environment`
- `configuration_status`
- `configuration_version`
- `readiness_status`
- `secret_refs`
- `feature_flag_key`
- `feature_flag_default`
- `kill_switch_key`
- `rotation`
- `expiration`
- `tenant_policy`
- `workspace_policy`
- `environment_policy`
- `secret_policy`
- `owner_id`
- `reviewer_ids`
- `created_at`
- `updated_at`
- `deprecated`
- `simulated`
- `executed`
- `real_provider_called`
- `metadata`

Rules:

- `configuration_version` is an integer greater than or equal to 1.
- `feature_flag_default` must be `false`.
- `kill_switch_key` is required.
- `secret_refs` must be non-empty and must contain references only.
- `simulated` must be `true`.
- `executed` must be `false`.
- `real_provider_called` must be `false`.
- Plaintext credentials are blocked.
- Provider calls are blocked.
- Runtime environment provider secrets are blocked.

## D. Secret Reference Contract

Secret references are placeholders for future secret management. They do not create, store, fetch, or expose a secret.

Required fields:

- `secret_ref_id`
- `secret_ref_type`
- `provider_id`
- `workspace_type`
- `tenant_id`
- `scope`
- `status`
- `created_at`
- `last_rotated_at`
- `rotation_due_at`
- `expires_at`
- `metadata`

Allowed reference types:

- `secret_ref`
- `vault_ref`
- `manual_fixture_ref`

Rules:

- `secret_ref_id` is an opaque reference, not a value.
- Secret reference provider, workspace and tenant must match the configuration.
- Rotation and expiration dates must be present.
- Expired references are blocked.
- Rotation-overdue references are blocked.
- No token, password, key, private key, session cookie, raw credential or OAuth code may appear in a reference.

## E. Configuration Registry

The Configuration Registry is a private in-memory registry for provider configuration records. It is infrastructure only.

Rules:

- storage is private
- returned registry is frozen
- records are cloned defensively
- history is cloned defensively
- no singleton is required
- initial records fail closed
- duplicate `configuration_id` is blocked
- update uses optimistic validation
- replayed changes are blocked
- no persistence is added
- no provider is called

The registry does not replace the Connector Lifecycle Runtime Registry or the Read-Only Adapter Registry. It only stores validated configuration records for future use.

## F. Configuration Validation

Validation must fail closed when:

- provider identity is missing
- adapter identity is missing
- connector identity is missing
- tenant or workspace policy does not match
- feature flag default is not off
- kill switch is missing
- secret reference is invalid
- rotation metadata is missing or due
- expiration metadata is missing or expired
- forbidden fields are present
- provider registry context says the provider is unknown
- runtime environment provider secret policy is enabled
- provider calls or provider SDK configuration are enabled

Evidence does not replace structural validation.

## G. Configuration Readiness Contract

Configuration readiness only means a configuration record is structurally valid for future mock binding or future review. It does not activate a real provider.

Readiness statuses:

- `not_ready`
- `configuration_ready_for_mock_binding`
- `blocked_by_secret_policy`
- `blocked_by_environment_policy`
- `blocked_by_tenant_policy`
- `blocked_by_workspace_policy`
- `blocked_by_rotation`
- `blocked_by_expiration`
- `blocked_by_feature_flag`
- `blocked_by_kill_switch`

No readiness status permits:

- real provider call
- OAuth
- secret lookup
- provider SDK execution
- `executed:true`
- `real_provider_called:true`

## H. Rotation Metadata

Rotation metadata is mandatory even though this PR does not rotate secrets.

Required behavior:

- `next_rotation_due_at` must exist.
- due or expired rotation blocks readiness.
- rotation status is informational and does not override date validation.
- rotation metadata is never a secret.
- future rotation requires a separate secret-management boundary.

## I. Expiration Metadata

Expiration metadata is mandatory.

Required behavior:

- `expires_at` must exist.
- expired configuration blocks readiness.
- expired secret reference blocks readiness.
- expiration status is informational and does not override date validation.

## J. Secret Policy

Secret policy must state:

- plaintext secrets are not allowed
- secret creation is not implemented
- secret values are not allowed
- secret references only are required

Blocked fields include:

- `token`
- `secret`
- `password`
- `apiKey`
- `accessToken`
- `refreshToken`
- `clientSecret`
- `privateKey`
- `sessionCookie`
- `oauthCode`
- `rawSecret`
- `providerCredential`

The sanitizer removes forbidden keys recursively and never returns their values.

## K. Environment Policy

Environment policy must state:

- provider calls are not allowed
- provider SDK configuration is not allowed
- runtime environment provider secrets are not allowed
- secret references only are required

This contract intentionally avoids using process runtime environment variables for provider credentials. Future provider configuration must use an explicit, reviewed secret-reference mechanism.

## L. Tenant Configuration Policy

Supported tenant policies:

- `tenant_id_required`
- `personal_user_tenant`
- `corporate_grupo_erick`
- `external_client_tenant`

Rules:

- corporate configuration requires `workspace_type: corporate` and `tenant_id: grupo_erick`
- personal configuration requires `workspace_type: personal` and `tenant_id: personal::<user_id>`
- external client configuration requires `workspace_type: external_client` and `tenant_id: client::<client_id>`
- provider configuration cannot override tenant identity
- prompt input cannot provide tenant identity by itself

## M. Workspace Configuration Policy

Supported workspace types:

- `personal`
- `corporate`
- `external_client`

Rules:

- the record workspace must be in `workspace_policy.allowed_workspace_types`
- workspace policy cannot widen tenant policy
- cross-workspace configuration is blocked
- cross-tenant configuration is blocked

## N. Audit Candidate For Configuration Changes

Every configuration change result must include a sanitized audit candidate.

Audit fields:

- `event_name`
- `trace_id`
- `change_id`
- `configuration_id`
- `provider_id`
- `adapter_id`
- `connector_id`
- `workspace_type`
- `tenant_id`
- `status`
- `applied`
- `previous_version`
- `new_version`
- `actor_id`
- `actor_role`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `error_code`
- `blocked_reason`
- `occurred_at`

Audit must never contain:

- raw configuration
- secret value
- request body
- response body
- headers
- cookies
- credentials
- payload
- stack trace

## O. Relationship With Existing Contracts

This boundary depends on and preserves:

- `CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md`
- `READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md`
- `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`
- `INTEGRATION_SECURITY_BOUNDARY.md`
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`
- `TENANT_WORKSPACE_ISOLATION.md`
- `PERMISSION_MATRIX.md`
- `GOVERNANCE_CHECK_REPORT.md`
- `OPERATOR_RUNBOOK.md`

It does not replace the readiness gate, lifecycle registry, adapter registry, permission matrix, security boundary, governance review, feature flag, kill switch, or operator approval.

## P. Phase Limits

This PR only creates contracts, validation, fixture, registry and tests.

It does not:

- implement provider real
- create OAuth
- create token or secret
- read provider credentials from runtime environment
- call API
- add SDK
- create persistent storage
- alter `/message`
- alter `/confirm`
- connect runtime to external systems

All results remain:

- `simulated:true`
- `executed:false`
- `real_provider_called:false`
- `can_trigger_real_execution:false`
