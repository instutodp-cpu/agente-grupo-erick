# Hermes Core Transcription Consent, Retention and Readiness Policy

This document defines the policy layer required before any future real
transcription provider can be considered. It is a contract-only foundation for
review. Hermes Core still does not transcribe audio.

## Scope

This PR adds deterministic policy modules, synthetic fixtures, sanitized audit
events and tests for transcription consent, retention, budget, operator
approval and provider readiness.

It does not add endpoints, upload handling, storage, queues, workers,
schedulers, runtime registration, production flags, provider credentials or
provider calls.

## Reused Architecture

The policy layer was designed after reviewing and reusing the existing Hermes
Core patterns for:

- `transcription-contract`
- `transcription-sanitized-adapter`
- provider configuration registry
- provider secret reference registry
- provider secret resolver
- connector lifecycle registry
- provider configuration readiness
- read-only adapter registry
- execution policy
- adapter audit events
- tenant/workspace isolation
- permission overlay
- security boundary
- governance report
- external provider audit, cost and rate-limit controls
- public web readiness and canary patterns

The new modules are pure CommonJS contracts. They use defensive cloning,
private in-memory registry state, explicit versions and fail-closed results.

## Consent

Transcription consent is mandatory. Missing, denied, revoked, expired,
cross-tenant, cross-transcription or implicit consent blocks readiness.

Allowed synthetic purposes are:

- `training_summary`
- `customer_service_review`
- `internal_meeting_summary`
- `development_test`

Consent never authorizes production, real audio transcription or automatic
execution. Granted consent must include an explicit version, `granted_by`, an
expiration and a scoped allowlist of non-write operations.

Revoked consent requires `revoked_at`. Revoked or expired consent cannot be
silently restored to granted by the in-memory registry.

## Retention

Raw media retention is always zero:

- `raw_media_retention_days: 0`
- raw audio storage is blocked
- buffer, binary, waveform and base64 payloads are blocked
- legal hold is blocked in this phase
- deletion policy must be present

Metadata retention is capped at 90 days. Sanitized transcript retention is
capped at 30 days. Indefinite, negative, excessive, expired or cross-tenant
policies block readiness.

This PR does not implement deletion or storage.

## Budget And Quotas

Budget policy is required before readiness can pass. Currency must be `BRL`,
environment must be `local_test` or `non_production`, rollout must remain `0`,
and concurrency is capped at one synthetic request.

Unlimited budgets, unlimited quotas, production, negative values and excessive
values are blocked. No counter, billing integration or real cost lookup is
implemented.

## Operator Approval

Operator approval is explicit, ephemeral and single use. The requester cannot
be the approver. Expired, consumed, cross-tenant, cross-candidate or production
approvals block readiness.

Allowed approval operations are:

- `evaluate_transcription_candidate`
- `simulate_transcription_readiness`

The approval contract does not activate any runtime path.

## Readiness

The readiness evaluator checks identity bindings across candidate, adapter,
connector lifecycle, provider configuration, secret reference, consent,
retention, budget, approval and tenant/workspace policy.

It also requires:

- adapter registered but runtime disabled
- provider real execution disabled
- configuration structurally ready
- secret reference described only, with no secret value
- feature flag off
- kill switch available
- rollout `0`
- production blocked
- network blocked
- raw media blocked
- storage blocked
- automatic execution blocked
- write/action/send/publish/delete blocked
- no endpoint, scheduler, worker or queue
- `real_provider_called:false`
- `external_network_called:false`
- `can_trigger_real_execution:false`

When every requirement is satisfied, the strongest verdict is
`READY_FOR_CONTROLLED_CANARY_REVIEW`. The evaluator never returns ready for
production or ready for real execution in this PR.

## Audit

Audit events contain only IDs, statuses, versions, decisions and sanitized
blocking reasons. They omit audio, raw transcripts, full text, provider objects,
configuration objects, credentials, headers, URLs and raw payloads.

## Roadmap

A future PR may propose a controlled canary design only after adding explicit
runtime approval, real secret references, storage/retention enforcement,
budget counters, tenant policy, operational audit sinks and a provider-specific
review. Production remains blocked until a separate production readiness review.

Remaining blockers for a real provider include consent capture UX, raw media
handling, storage deletion guarantees, rate-limit counters, provider contract
verification, operational incident runbooks and external network authorization.
