# Connector Lifecycle and Runtime Registry

## A. Objective

The Connector Lifecycle Runtime Registry controls the state of each connector and adapter candidate before any real integration can exist. It prevents informal activation, records explicit transitions, binds provider, adapter, workspace and tenant policy, and keeps readiness gate, feature flag and kill switch requirements visible.

This contract creates lifecycle infrastructure only. It does not call providers, does not register a real integration in the main runtime, does not create OAuth, tokens, secrets, persistent storage, network access or database access, and does not change `/message` or `/confirm`.

## B. Official distinctions

Connector:
- Logical integration with a service or source.
- Future examples: `public_web_firecrawl`, `github_read_only`, `corporate_gmail`.

Provider:
- External vendor or system behind a connector.
- Future examples: Firecrawl, GitHub, Google, Supabase.

Adapter:
- Technical implementation that follows `READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md`.

Lifecycle record:
- Operational and governance state for one connector.

Runtime registry:
- Private in-memory registry of valid lifecycle records.
- Contains no secrets.
- Calls no provider.
- Does not replace the read-only adapter registry.
- Accepts new records only in `registered` state in this PR.

## C. Official lifecycle states

States:
- `unregistered`
- `registered`
- `candidate`
- `mock_only`
- `readiness_pending`
- `readiness_blocked`
- `readiness_passed`
- `configuration_pending`
- `feature_flag_off`
- `runtime_disabled`
- `canary_ready`
- `canary_active`
- `read_only_ready`
- `read_only_active`
- `paused`
- `blocked`
- `deprecated`
- `retired`

Rules in this PR:
- The maximum operational state is `mock_only`.
- `canary_ready`, `canary_active`, `read_only_ready` and `read_only_active` are contract states only and cannot be reached.
- No state calls a real provider.
- `read_only_active` is structurally blocked until a future PR.
- Lifecycle state is not execution permission.
- Feature flag and kill switch remain mandatory.

## D. Official transition events

Events:
- `register_connector`
- `nominate_candidate`
- `enable_mock_only`
- `request_readiness_review`
- `block_readiness`
- `pass_readiness`
- `request_configuration`
- `mark_feature_flag_off`
- `disable_runtime`
- `prepare_canary`
- `activate_canary`
- `mark_read_only_ready`
- `activate_read_only`
- `pause_connector`
- `block_connector`
- `resume_connector`
- `deprecate_connector`
- `retire_connector`

Allowed in this PR:
- `unregistered -> registered`
- `registered -> candidate`
- `registered -> runtime_disabled`
- `candidate -> mock_only`
- `candidate -> readiness_pending`
- `mock_only -> runtime_disabled`
- `readiness_blocked -> runtime_disabled`
- `readiness_passed -> runtime_disabled`
- `configuration_pending -> runtime_disabled`
- `feature_flag_off -> runtime_disabled`
- `paused -> runtime_disabled`
- `runtime_disabled -> mock_only`
- `runtime_disabled -> readiness_pending`
- `readiness_pending -> readiness_blocked`
- `readiness_pending -> readiness_passed`
- `readiness_blocked -> readiness_pending`
- `readiness_passed -> configuration_pending`
- `configuration_pending -> feature_flag_off`
- operational states to `paused`
- any non-retired state to `blocked` when policy requires it
- `mock_only`, `paused` or `blocked` to `deprecated`
- `deprecated -> retired`

Blocked in this PR:
- `prepare_canary`
- `activate_canary`
- `mark_read_only_ready`
- `activate_read_only`
- any transition to `canary_active`, `read_only_ready` or `read_only_active`

## E. Transition guards

Every transition validates:
- connector exists
- transition event is allowed
- source state is correct
- target state is allowed in this phase
- `actor_id` is present
- `reason` is sanitized
- timestamp is valid
- `expected_version` matches
- `transition_id` is present and has not been processed before
- workspace types are declared
- tenant strategy is declared
- provider and adapter are bound
- feature flag key is declared
- kill switch key is declared
- no-write guarantee holds
- forbidden fields are absent

Specific guards:
- `registered -> candidate` requires provider id, adapter id, owner and supported workspace/domain/capability/operation declarations.
- `candidate -> mock_only` requires adapter kind `mock`, adapter present in the adapter registry, valid metadata, no real provider, explicit feature flag and explicit kill switch.
- `candidate -> readiness_pending` requires readiness candidate id, non-empty contract refs, mock parity, owner and reviewers.
- `readiness_pending -> readiness_passed` requires a complete PR #59 readiness result with status `ready_for_real_read_only_pr`, verdict `allow_future_read_only_pr`, matching candidate/provider/adapter identity, empty blocking arrays and safe flags.
- `readiness_passed -> configuration_pending` does not enable execution.
- `configuration_pending -> feature_flag_off` requires feature flag default off, kill switch and no secrets.
- `disable_runtime` always sets `runtime_enabled:false`, `execution_mode:disabled` and a non-real rollout stage.
- `resume_connector` returns only to `runtime_disabled`; it never jumps directly back to `mock_only`.
- `runtime_disabled -> mock_only` requires the same mock adapter binding as `candidate -> mock_only`.

## Registration rules

Normal `registerConnector` accepts only a new connector record with:
- `lifecycle_state: registered`
- `lifecycle_version: 1`
- `runtime_enabled:false`
- `real_provider_enabled:false`
- `execution_mode: contract_only` or `disabled`
- `rollout_stage: contract` or `none`
- `deprecated:false`
- `retired:false`
- `feature_flag_default:false`

`initialRecords` follows the same rule in this PR. Advanced snapshot restore is not implemented in this phase. Any future restore mode must be explicit, separately reviewed and fail-closed.

## F. Connector lifecycle record

Minimum fields:
- `connector_id`
- `connector_type`
- `provider_id`
- `provider_type`
- `adapter_id`
- `adapter_kind`
- `readiness_candidate_id`
- `lifecycle_state`
- `lifecycle_version`
- `workspace_types`
- `tenant_strategy`
- `domains`
- `capabilities`
- `operations`
- `owner_id`
- `reviewer_ids`
- `feature_flag_key`
- `feature_flag_default`
- `kill_switch_key`
- `runtime_enabled`
- `real_provider_enabled`
- `execution_mode`
- `rollout_stage`
- `risk_level`
- `cost_risk`
- `rate_limit_risk`
- `data_classification`
- `created_at`
- `updated_at`
- `deprecated`
- `retired`
- `metadata`
- `contract_refs`

Rules:
- `connector_id` is unique.
- `lifecycle_version` is an integer greater than or equal to 1.
- `runtime_enabled:false` in this PR except for local mock-only state.
- `real_provider_enabled:false`.
- `feature_flag_default:false`.
- Allowed execution modes in this PR: `disabled`, `contract_only`, `mock_only`.
- Allowed rollout stages in this PR: `none`, `contract`, `mock`.
- No secret or token.
- Metadata is sanitized.
- Operations are read-only or draft candidates only.
- `adapter_kind: real_read_only` is blocked.

## G. Transition request

Fields:
- `trace_id`
- `transition_id`
- `connector_id`
- `transition_event`
- `expected_version`
- `actor_id`
- `actor_role`
- `reason`
- `requested_at`
- `evidence`
- `simulated`
- `executed`
- `real_provider_called`

Rules:
- `simulated:true`.
- `executed:false`.
- `real_provider_called:false`.
- Evidence is sanitized.
- Reason is short and sanitized.
- `expected_version` is required for optimistic concurrency.
- `transition_id` is required for replay protection.
- `transition_id` must be globally unique inside the registry.
- Replaying a processed `transition_id` returns `REPLAYED_TRANSITION`, does not increment version and does not append duplicate history.

## H. Transition response

Fields:
- `trace_id`
- `transition_id`
- `connector_id`
- `previous_state`
- `new_state`
- `previous_version`
- `new_version`
- `transition_event`
- `status`
- `applied`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `blocking_reasons`
- `warnings`
- `lifecycle_record`
- `transition_audit_event`

Rules:
- A valid transition may have `applied:true`.
- `applied:true` does not mean a provider executed.
- `executed:false`.
- `real_provider_called:false`.
- `can_trigger_real_execution:false`.
- Lifecycle record is sanitized.
- Raw input is never returned.
- Blocked responses include a safe `error` object with `error_code` and sanitized `blocked_reason`.

## I. Transition statuses

- `lifecycle_transition_applied`
- `lifecycle_transition_blocked`
- `lifecycle_transition_invalid`
- `lifecycle_version_conflict`
- `lifecycle_connector_not_found`
- `lifecycle_duplicate_connector`
- `lifecycle_contract_violation`
- `lifecycle_internal_error_safe`

## J. Error codes

- `INVALID_CONNECTOR_RECORD`
- `CONNECTOR_NOT_FOUND`
- `DUPLICATE_CONNECTOR`
- `INVALID_TRANSITION`
- `TRANSITION_NOT_ALLOWED_IN_THIS_PHASE`
- `VERSION_CONFLICT`
- `READINESS_EVIDENCE_REQUIRED`
- `ADAPTER_NOT_REGISTERED`
- `ADAPTER_KIND_NOT_ALLOWED`
- `FEATURE_FLAG_POLICY_INVALID`
- `KILL_SWITCH_POLICY_INVALID`
- `TENANT_STRATEGY_INVALID`
- `FORBIDDEN_FIELD_DETECTED`
- `UNSAFE_OPERATION`
- `INTERNAL_LIFECYCLE_ERROR`
- `REPLAYED_TRANSITION`
- `INITIAL_STATE_NOT_ALLOWED`
- `INVALID_INITIAL_CONNECTOR_STATE`

## K. Optimistic concurrency

- Every mutation uses `expected_version`.
- Mismatch returns `lifecycle_version_conflict`.
- Version conflict does not alter the record.
- Version increments exactly 1 for an applied transition.
- Records cannot be overwritten directly.
- Concurrent transitions cannot be lost silently.
- Two different transition ids with the same stale `expected_version` cannot both apply.

## L. Lifecycle history

Each history event stores:
- `event_id`
- `trace_id`
- `transition_id`
- `connector_id`
- `previous_state`
- `new_state`
- `previous_version`
- `new_version`
- `transition_event`
- `actor_id`
- `actor_role`
- `reason_code`
- `applied`
- `status`
- `created_at`
- `simulated`
- `executed`
- `real_provider_called`

Never store:
- raw evidence
- raw input
- token
- secret
- payload
- headers
- cookies
- credentials

## M. Runtime registry behavior

- Storage is private.
- Registry object is frozen.
- Records are cloned defensively.
- History is cloned defensively.
- History is bounded per connector. The default maximum is 100 events and the accepted range is 1 to 1000.
- When the limit is exceeded, the oldest retained events are removed deterministically.
- `connector_id` is unique.
- There is no access to the internal Map.
- There is no mandatory singleton.
- Initial records are validated fail-closed and atomically.
- Initial records and normal registration accept only `registered` records with `lifecycle_version:1`, `runtime_enabled:false`, `real_provider_enabled:false`, `feature_flag_default:false`, non-deprecated and non-retired flags.
- Direct registration of `candidate`, `mock_only`, `readiness_passed`, `feature_flag_off`, `deprecated`, `retired` or any advanced state is blocked.
- There is no silent partial initialization.

## N. Relationship with adapter registry

- Lifecycle registry does not replace adapter registry.
- `adapter_id` must exist in the adapter registry when a transition requires `mock_only`.
- Lifecycle registry never inserts an adapter directly.
- Lifecycle registry does not receive access to adapter registry storage.
- Integration happens only through public APIs.

## O. Readiness binding

- Readiness result cannot be a forged partial object.
- Candidate id, provider id and adapter id must match.
- Verdict, status and fixed safety flags are validated.
- Blocking requirements and blocking reasons must be empty.
- `readiness_passed` does not activate real runtime.

## P. Phase ceiling

In this PR:
- `maximum_reachable_state: mock_only`.
- Real runtime is blocked.
- Canary is blocked.
- `read_only_active` is blocked.
- `real_provider_enabled:false`.
- `runtime_enabled` can only represent local mock execution.
- No transition changes `real_provider_called:false`.

## Q. Relationship with existing contracts

This contract relies on and does not replace:
- `READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md`
- `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`
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

## R. Real Provider Configuration Boundary

`REAL_PROVIDER_CONFIGURATION_BOUNDARY.md` is the next boundary after connector
lifecycle control. It defines provider configuration records, secret references,
rotation and expiration metadata, tenant/workspace policies, private registry
behavior and sanitized configuration audit candidates. A lifecycle state such
as `readiness_passed` still does not activate runtime or provider calls without
this configuration boundary and a future approved integration PR.
