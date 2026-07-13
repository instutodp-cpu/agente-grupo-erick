# Real Provider Configuration Boundary

## A. Objetivo

Real Provider Configuration Boundary is the official contract for future provider configuration in Hermes Core. It defines how provider configuration records, secret references, readiness metadata, rotation metadata, expiration metadata, tenant policy, workspace policy and audit candidates must be represented before any real provider can be proposed in a future PR.

This PR does not implement providers. It does not create OAuth. It does not create secrets. It does not read runtime environment variables for provider credentials. It does not call APIs, add SDKs, persist storage, or connect the adapter runtime to any external service.

The boundary exists so future real read-only providers cannot be introduced with ad hoc configuration, raw credentials, unclear tenant ownership, missing rotation, missing expiration, or missing kill switch policy.

This boundary now has four isolated runtime-safe components:

- Provider Configuration Contract.
- Provider Secret Reference Registry.
- Local Test Secret Resolver.
- Provider Configuration Readiness evaluator.

These components are still contract infrastructure only. They do not create or
resolve real credentials, do not call providers, do not read `process.env`, do
not use filesystem secret paths, and do not connect to `/message` or `/confirm`.

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

Official configuration states:

- `unconfigured`
- `descriptor_registered`
- `reference_pending`
- `reference_registered`
- `validation_pending`
- `validation_blocked`
- `structurally_ready`
- `rotation_required`
- `expired`
- `revoked`
- `disabled`
- `deprecated`

Initial registration accepts only:

- `configuration_status: descriptor_registered`
- `readiness_status: not_ready`
- `configuration_version: 1`
- `deprecated:false`
- `disabled:false`
- `feature_flag_default:false`
- `kill_switch_required:true`

Direct registration in `structurally_ready`, `expired`, `revoked`, `disabled`
or `deprecated` is blocked by `INITIAL_CONFIGURATION_STATE_NOT_ALLOWED`.

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
- `secret_reference_descriptors`
- `secret_reference_type`
- `required_secret_names`
- `required_scopes`
- `allowed_operations`
- `rotation_policy`
- `expiration_policy`
- `revocation_policy`
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
- `required_secret_names` and `required_scopes` must be non-empty.
- wildcard or privileged scopes such as `*`, `all`, `admin`, `full_access`,
  `write`, `repo` and `root` are blocked.
- `allowed_operations` must remain read-only and cannot include create, update,
  delete, write, send, publish, merge, payment or similar action terms.
- `cost_risk` and `rate_limit_risk` cannot be `unknown`.
- `kill_switch_required` must be `true`.
- `tenant_policy` must match the connector lifecycle `tenant_strategy` when
  present.
- `user_id` is conditionally required for `personal_user_tenant`.
- `client_id` is conditionally required for `external_client_tenant`.

Immutable identity fields cannot be changed after registration:

- `configuration_id`
- `connector_id`
- `provider_id`
- `provider_type`
- `adapter_id`
- `readiness_candidate_id`
- `workspace_type`
- `tenant_id`
- `organization_id`
- `client_id`
- `environment`
- `secret_reference_type`
- `owner_id`

Attempts to mutate identity return
`CONFIGURATION_IDENTITY_MUTATION_BLOCKED`, do not increment version and do not
change the stored record.

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

Allowed resolvable type in this PR:

- `local_test_double_reference`

Future reference types are documented but unsupported in this PR:

- `railway_variable_reference`
- `aws_secrets_manager_reference`
- `gcp_secret_manager_reference`
- `azure_key_vault_reference`
- `hashicorp_vault_reference`
- `supabase_vault_reference`
- `github_actions_secret_reference`
- `kubernetes_secret_reference`

These future types must return `unsupported_in_current_phase`,
`SECRET_REFERENCE_TYPE_UNSUPPORTED` or `ready:false` until a future approved
secret manager boundary exists.

Rules:

- `secret_ref_id` is an opaque reference, not a value.
- Secret reference provider, workspace and tenant must match the configuration.
- Rotation and expiration dates must be present.
- Expired references are blocked.
- Rotation-overdue references are blocked.
- No token, password, key, private key, session cookie, raw credential or OAuth code may appear in a reference.
- No real path, ARN, environment variable name, connection string or vault path
  may appear in a reference.
- Unknown reference fields are blocked fail-closed.
- Reference metadata uses an allowlist and cannot contain arbitrary credential
  material.
- Initial reference registration accepts only `reference_pending` or
  `reference_registered`.

## D1. Provider Secret Reference Registry

The Provider Secret Reference Registry is the authoritative in-memory registry
for secret references.

Required API behavior:

- private storage
- frozen registry object
- defensive clones
- unique `reference_id`
- fail-closed atomic initial references
- bounded sanitized history
- optimistic concurrency
- replay protection by `change_id`
- no direct deletion of operational references
- no secret value
- no real path
- no real ARN
- no runtime environment variable name
- no connection string

Supported state mutations:

- `mark_revoked`
- `mark_disabled`
- `mark_rotation_required`

The registry does not resolve a secret. It only validates and stores safe
reference descriptors.

Every reference change request must include an `operation` that matches the
method being called. Blocked reference changes, including invalid requests,
missing references, version conflicts and replayed changes, must still return a
sanitized `audit_event_candidate`. That audit never contains the full reference
or any secret handle.

## D2. Local Test Secret Resolver

The only resolver in this PR is `local_test_secret_resolver`.

It can resolve only:

- `reference_type: local_test_double_reference`
- `environment: local_test`
- `synthetic:true`

It must fail closed for production, future real secret-reference types,
revoked references, disabled references, expired references and rotation-due
references.

`resolveReference` requires a complete Secret Access Context. It must never
resolve with only `{ "environment": "local_test" }`.

Secret Access Context fields:

- `trace_id`
- `request_id`
- `configuration_id`
- `connector_id`
- `provider_id`
- `adapter_id`
- `workspace_type`
- `tenant_id`
- `environment`
- `purpose`
- `requested_by`
- `simulated`
- `executed`
- `real_provider_called`

Allowed access purposes:

- `configuration_structure_validation`
- `local_test_readiness_validation`
- `synthetic_contract_test`

The context must match the reference provider, workspace, tenant and
environment. `environment` must be `local_test`; `simulated:true`,
`executed:false` and `real_provider_called:false` are mandatory. Forbidden
fields or secret-value material in the context block resolution.

`resolveReference` may return only an opaque synthetic handle:

```json
{
  "resolved": true,
  "secret_handle": "opaque_test_handle::<reference_id>",
  "synthetic": true,
  "exportable": false
}
```

The handle is not a credential, cannot be converted into a credential, must not
appear in readiness responses, must not appear in audit and must not appear in
history.

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

Readiness must validate:

- connector exists via public lifecycle registry API
- connector, provider, adapter, tenant, workspace and readiness candidate IDs match
- lifecycle state is one of `readiness_passed`, `configuration_pending`,
  `feature_flag_off` or `runtime_disabled`
- blocked, deprecated, retired and early lifecycle states are blocked
- adapter exists via public adapter registry API
- adapter metadata validates
- adapter is `real_read_only_candidate` or structural local mock test adapter
- `real_read_only` is blocked
- secret reference exists via public secret reference registry API
- secret reference provider, tenant, workspace and environment match
- secret reference is synthetic `local_test_double_reference`
- reference is not revoked, disabled, expired or rotation due
- local test resolver can resolve structurally
- no handle or secret value is returned

The `evaluate_readiness` registry operation must call an injected readiness
evaluator. It cannot accept readiness supplied by a patch or prompt. The
evaluator context must include lifecycle registry, adapter registry, secret
reference registry, secret resolver and clock. Missing evaluator or missing
binding context fails closed with
`CONFIGURATION_READINESS_BINDING_INVALID`.

The readiness result must match the configuration identity exactly:

- `configuration_id`
- `connector_id`
- `provider_id`
- `adapter_id`
- `readiness_candidate_id`

It must also contain:

- `status: configuration_structurally_ready`
- `readiness_status: configuration_structurally_ready`
- `ready:true`
- `simulated:true`
- `executed:false`
- `real_provider_called:false`
- `can_trigger_real_execution:false`
- `secret_resolution_performed:false`
- `secret_value_exposed:false`
- empty `blocking_reasons`
- `error:null`

Any mismatch, blocking reason, forbidden field or `secret_handle` blocks the
transition and does not increment `configuration_version`.

Public readiness result keeps:

- `secret_resolution_performed:false`
- `secret_value_exposed:false`
- no `secret_handle`
- `simulated:true`
- `executed:false`
- `real_provider_called:false`
- `can_trigger_real_execution:false`

## G1. Configuration State Machine

Allowed transitions in this PR:

- `descriptor_registered -> reference_pending`
- `reference_pending -> reference_registered`
- `reference_pending -> validation_blocked`
- `reference_registered -> validation_pending`
- `reference_registered -> revoked`
- `reference_registered -> disabled`
- `validation_pending -> validation_blocked`
- `validation_pending -> structurally_ready` only through trusted
  `evaluate_readiness` binding
- `validation_blocked -> validation_pending`
- `validation_blocked -> disabled`
- `structurally_ready -> rotation_required`
- `structurally_ready -> expired`
- `structurally_ready -> revoked`
- `structurally_ready -> disabled`
- `structurally_ready -> deprecated`
- `rotation_required -> disabled`
- `rotation_required -> revoked`
- `rotation_required -> deprecated`
- `expired -> revoked`
- `expired -> disabled`
- `expired -> deprecated`
- `revoked -> deprecated`
- `disabled -> deprecated`

No direct jump activates a provider. No state enables `real_provider_called:true`.
`deprecated` is terminal in this PR.

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
- rotation-due secret reference blocks readiness.
- revoked or disabled secret reference blocks readiness.
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
- `secret_value`
- `rawValue`
- `connectionString`
- `databaseUrl`
- `vaultPath`
- `secretArn`
- `secretResourceName`
- `environmentVariableName`
- `secret_handle`

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
- `tenant_id_required` requires a non-empty `tenant_id`
- `personal_user_tenant` requires non-empty `user_id`
- `external_client_tenant` requires non-empty `client_id`
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
- full descriptor
- full reference
- secret names complete list
- scopes complete list
- secret handle
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
- implement real secret manager
- create OAuth
- create token or secret
- read provider credentials from runtime environment
- accept real secret paths, ARNs or environment variable names
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
