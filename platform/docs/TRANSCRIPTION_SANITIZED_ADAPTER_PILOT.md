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

The dry-run uses a fake provider object only. Injected providers must carry an
explicit synthetic contract:

- `provider_kind: synthetic_test_double`
- `network_capable: false`
- `real_provider: false`
- a `summarize()` function
- a call probe
- no endpoint, URL, token, headers, cookies, credentials or secret fields

Providers that do not meet that contract are blocked before `summarize()` with
`executed:false`, `real_provider_called:false`, `external_network_called:false`
and `can_trigger_real_execution:false`.

The adapter validates the raw request before sanitization, then passes only a
sanitized copy to the fake provider. The fake provider returns a raw result;
that raw result is validated for forbidden fields, segment boundaries, size and
URLs before any sanitized response is built. Sanitization cannot turn an
invalid request or result into success.

The dry-run also runs `provider.summarize()` inside a local network deny
harness. The harness temporarily intercepts `globalThis.fetch`, `http`,
`https`, `net`, `tls` and `dns` entry points, increments `network_attempts` and
throws `TRANSCRIPTION_NETWORK_ACCESS_BLOCKED` before any connection can be
opened. Interceptors are guarded by a process-local mutex and restored in
`finally`; this harness is only for local/test dry-runs and is not a production
network sandbox.

The provider metadata remains a precondition, but absence of network is proven
only by the harness counter. Final evidence derives `external_network_called`
from `network_attempts > 0`.

## Lifecycle And Readiness

The pilot documents these product-level states:

- `registered`
- `configured`
- `validated`
- `ready`
- `pilot_enabled`
- `production_blocked`

Internally, it maps readiness to the existing Hermes Core lifecycle and
configuration readiness mechanisms. The dry-run registers a connector in the
real lifecycle registry, applies real lifecycle transitions, and uses that same
updated registry for readiness. A provider can only pass readiness when the
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
