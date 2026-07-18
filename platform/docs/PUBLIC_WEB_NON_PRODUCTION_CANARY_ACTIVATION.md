# Public Web Non-Production Canary Activation

## Objective

This contract defines a manual, temporary and auditable activation path for the
Public Web Read-Only Adapter in development or staging only.

It is limited to public allowlisted targets, read-only operations, authorized
operators and explicit approvals. It does not integrate with `/message`,
`/confirm`, `src/index.js`, schedulers, cron jobs or the main runtime.

Production remains structurally blocked.

## Pilot Foundation Versus Canary Activation

Pilot foundation provides contracts, policies, transports, adapter metadata,
pilot gate, tests and default-off behavior.

Canary activation adds a manual session, explicit temporal approval, exact
target allowlist, one-request execution, metrics, audit and a sanitized
post-run report.

## Canary States

Official states:

- inactive
- requested
- validation_pending
- approved_pending
- validation_blocked
- approved
- active
- executing
- completed
- failed_safe
- expired
- cancelled
- kill_switch_terminated

Initial state is `inactive`. A session can only be created through
`request_canary`, which creates `requested`. `approved` never executes
automatically. `executing` only occurs inside `executeCanaryRequest`.
Completed, failed, expired, cancelled and kill-switch states are terminal.
Production can never become approved or active.

## Canary Session

Required session fields include:

- canary_session_id
- trace_id
- connector_id
- configuration_id
- adapter_id
- provider_id
- readiness_candidate_id
- workspace_type
- tenant_id
- user_id
- operator_id
- operator_role
- environment
- target_origin
- target_path_hash
- source_type
- operation
- feature_flag_key
- feature_flag_enabled
- kill_switch_key
- kill_switch_active
- rollout_percentage
- maximum_requests
- requests_used
- started_at
- expires_at
- canary_state
- lifecycle_version
- configuration_version
- readiness_evidence_id
- approval_id
- approved_by
- approved_at
- cancellation_reason
- terminal_reason
- simulated
- executed
- real_provider_called
- version

Rules:

- environment is only `development` or `staging`
- full URL and query are never stored
- target origin must be allowlisted
- rollout must be greater than 0 and at most 1
- maximum requests must be between 1 and 5
- session lifetime is capped at 30 minutes
- one tenant, one workspace and one user
- feature flag must be explicit
- kill switch must be inactive
- production is blocked

## Session Operations

Allowed operations:

- request_canary
- validate_canary
- approve_canary
- activate_canary
- execute_canary_request
- complete_canary
- cancel_canary
- expire_canary
- terminate_by_kill_switch

Blocked operations include production activation, bypassing approval, widening
allowlists, increasing rollout, extending without review, execution from
message/confirm, scheduled execution, background execution, disabling audit,
disabling SSRF policy, disabling budget and disabling kill switch.

## Approval

Approval must include operator, approver, reason, scope, environment, target
origin, operation, request limit, expiration, evidence hash, lifecycle version,
configuration version, readiness evidence, feature flag state and kill switch
state.

Approvals are explicit, temporal, scoped, non-reusable, non-transferable,
revocable and replay-protected. Dual approval blocks self-approval.

## Execution Result

Execution result fields include:

- canary_session_id
- canary_execution_id
- trace_id
- request_id
- status
- target_origin_hash
- source_type
- operation
- result_count
- safe_summary
- structured_results
- warnings
- duration_ms
- bytes_received
- redirects_followed
- http_status_class
- rate_limit_metadata
- cost_metadata
- executed
- real_provider_called
- can_trigger_real_execution
- audit_event_candidate
- error

After network starts, `executed:true` and `real_provider_called:true` are
mandatory. Blocks before network remain `executed:false` and
`real_provider_called:false`. `can_trigger_real_execution:false` remains fixed.

No result may contain raw body, HTML, headers, cookies, secret handles, remote
IP, full URL or stack traces.

## Target Allowlist

The target allowlist is exact-origin only. It allows HTTPS, development or
staging, explicit path prefixes, explicit operations, explicit source types and
explicit content types. It does not allow wildcard hosts, implicit subdomains,
custom ports, query expansion, redirects, production, localhost, private IPs or
cloud metadata services.

## DNS And HTTPS

The safe DNS resolver validates all A and AAAA records. Zero results block.
Any private or reserved IP blocks the whole hostname. The resolver rechecks
immediately before connection and blocks changed results.

The HTTPS client uses only Node.js standard modules. It performs GET/HEAD only,
uses manual redirect mode, sends no request body, pins lookup to the approved
IP, preserves SNI and Host header, requires TLS validation, validates
content-length, streams bounded content, supports abort and never exposes raw
headers or remote IP outside internal validation.

## Runner

`src/pilots/public-web-canary-runner.js` is a library invoked explicitly by an
operator-controlled tool or test harness. It is not imported by `src/index.js`
and creates no endpoint, scheduler or startup execution.

The runner requires injected registries, readiness, configuration, secret
resolver, DNS resolver, HTTPS client, budgets, feature flag resolver, kill
switch resolver, operator policy, audit sink and clock.

It executes at most one request per call.

## Audit

Audit events:

- public_web_canary_requested
- public_web_canary_validation_passed
- public_web_canary_validation_blocked
- public_web_canary_approved
- public_web_canary_activated
- public_web_canary_request_started
- public_web_canary_request_succeeded
- public_web_canary_request_failed_safe
- public_web_canary_completed
- public_web_canary_expired
- public_web_canary_cancelled
- public_web_canary_kill_switch_terminated

Audit never includes full URLs, query strings, raw body, HTML, headers, remote
IP, cookies, credentials, tokens, secrets or stack traces.

## Post-Canary Report

Reports include session state, environment, tenant, workspace, operator,
approver, target hash, operation, request counts, provider-call counts, bytes,
duration, blocked categories, recommendation and fixed safety flags.

Recommendations are:

- remain_disabled
- fix_before_next_canary
- eligible_for_second_canary
- terminate_candidate

No recommendation authorizes production.

## Default State After Merge

- feature flag off
- rollout 0
- canary inactive
- production blocked
- no automatic call
- no public endpoint
- no runtime registration
- no scheduler
- no secret
- no external network in CI
- `/message` unchanged
- `/confirm` unchanged

## Relationship With Existing Contracts

- `PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md`
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`
- `REAL_PROVIDER_CONFIGURATION_BOUNDARY.md`
- `CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md`
- `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`
- `READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md`
- `INTEGRATION_SECURITY_BOUNDARY.md`
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`
- `TENANT_WORKSPACE_ISOLATION.md`
- `PERMISSION_MATRIX.md`
- `GOVERNANCE_CHECK_REPORT.md`
- `OPERATOR_RUNBOOK.md`
# Public Web Canary Operational Trial Relationship

`PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL.md` usa os contratos de sessão, aprovação, target allowlist, DNS seguro, HTTPS client, runner, audit e report desta ativação. A execução operacional continua manual, temporal, não produtiva, sem endpoint, sem scheduler e sem integração com `/message` ou `/confirm`.
