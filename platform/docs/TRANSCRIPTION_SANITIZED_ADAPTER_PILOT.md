# Hermes Core Transcription Sanitized Adapter Pilot

This PR adds the contract-only foundation for a future transcription provider.
It does not add an endpoint, does not integrate with `/message` or `/confirm`,
does not enable production, does not create a scheduler or worker, and does not
perform real transcription.

## Architecture

The pilot reuses Hermes Core primitives instead of creating a parallel
integration stack:

- provider configuration registry
- provider secret reference registry
- local test secret resolver
- connector lifecycle state machine
- provider configuration readiness evaluator
- read-only adapter registry
- adapter audit event envelope
- public-web canary-compatible safety flags

The adapter is isolated under `src/adapters/transcription` and is only reached
by tests or the pilot module. It is not imported by `src/index.js`, `/message`,
`/confirm`, the scheduler surface, or any worker.

## Contract

Every transcription candidate request requires:

- `transcription_id`
- `provider_id`
- `adapter_id`
- `media_type`
- `language`
- `duration_ms`
- `size_bytes`
- `created_at`

Allowed sanitized result fields are:

- `segments`
- `text`
- `confidence`
- `language_detected`
- `duration_ms`

The contract removes or blocks raw audio, binary data, waveform data,
credentials, request headers, cookies, provider tokens, raw provider responses,
raw transcripts, unexpected URLs and oversized base64-like payloads.

## Safety Limits

This phase is fail-closed:

- `simulated:true`
- `executed:false` before the adapter dry-run boundary
- `real_provider_called:false` always
- `can_trigger_real_execution:false` always
- production remains blocked
- external network calls are not allowed in CI
- no secret values are introduced

The dry-run uses a fake provider object only. The fake provider proves the
adapter path can sanitize output and emit audit evidence without contacting any
external service.

## Lifecycle And Readiness

The pilot documents these product-level states:

- `registered`
- `configured`
- `validated`
- `ready`
- `pilot_enabled`
- `production_blocked`

Internally, it maps readiness to the existing Hermes Core lifecycle and
configuration readiness mechanisms. A provider can only pass readiness when the
adapter is loaded, configuration is valid, the local synthetic secret reference
is resolvable, lifecycle is eligible, the real provider is disabled and runtime
remains disabled.

## Roadmap

Future PRs may add a real provider only after a dedicated readiness review,
budget controls, tenant/workspace policy, retention policy, consent policy,
provider-specific secret references and explicit operator approval. Provider
choices such as Whisper, Deepgram, AssemblyAI, Google Speech or Azure Speech are
intentionally outside this PR.

## Future Integration

Future runtime integration must remain explicit. It must not be wired into
`/message`, `/confirm`, uploads, storage, queues, schedulers or workers until a
separate PR adds policy, approvals and tests for that surface.
