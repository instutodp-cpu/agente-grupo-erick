# Hermes Core Transcription Controlled Canary Session

## Objective

This document defines the contract-only foundation for a future controlled transcription canary session.

The current scope is limited to synthetic contracts, state transitions, preflight checks, one-use authorization, evidence, reports, cleanup, rollback, fixtures, and tests.

## Non Objectives

Hermes Core does not transcribe audio in this PR.

This PR does not add uploads, endpoints, runtime integration, workers, schedulers, queues, storage, database tables, provider calls, network calls, secrets, production enablement, or rollout.

## Architecture

The canary session layer reuses the existing Hermes Core transcription and governance foundation:

- `transcription-contract`
- `transcription-sanitized-adapter`
- consent, retention, budget, operator approval, and provider readiness policies
- connector lifecycle and provider configuration patterns
- secret reference descriptors
- adapter registry and audit event patterns
- public-web canary session and operational trial replay patterns
- feature flag, kill switch, and tenant/workspace isolation controls

The modules are pure CommonJS under `platform/services/api/src/core`.

## Session Lifecycle

Allowed states:

- `created`
- `preflight_passed`
- `authorized`
- `running_simulation`
- `completed`
- `blocked`
- `expired`
- `cancelled`
- `rolled_back`
- `cleaned_up`

The happy path is:

`created -> preflight_passed -> authorized -> running_simulation -> completed -> cleaned_up`

Alternative paths end in `blocked`, `expired`, `cancelled`, or `rolled_back`, and can then be cleaned up.

The session is ephemeral. It uses optimistic concurrency, transition IDs, replay protection, immutable identity bindings, and sanitized bounded history.

## Preflight

Preflight is deterministic and fail-closed. It checks readiness, consent, retention, budget, operator approval, tenant/workspace binding, feature flag state, kill switch, rollout, production blocking, network blocking, raw media absence, storage absence, endpoint absence, worker absence, scheduler absence, queue absence, upload absence, and secret-value absence.

Preflight can only allow a synthetic simulation. It never authorizes real provider execution, real audio, network access, or production.

## One-Use Authorization

Authorization is explicit, scoped, non-production, single-use, and valid for at most five minutes. It blocks self-approval, replay, tenant mismatch, session mismatch, candidate mismatch, expiration, invalid timestamps, and forbidden operations.

Successful consumption marks `consumed_at` and does not call any provider.

## Synthetic Runner

The runner accepts only synthetic metadata: IDs, duration, language, segment count, confidence, and short placeholder text.

It blocks raw audio, buffers, binary data, base64 payloads, waveforms, files, paths, streams, uploads, URLs, endpoints, provider payloads, raw transcripts, raw provider responses, secrets, tokens, headers, cookies, and credentials.

The runner validates input before sanitization, verifies session/preflight/authorization, consumes the authorization, transitions the session to `running_simulation`, creates a local synthetic result, builds evidence, transitions to `completed`, and never calls a real adapter, provider, network, or filesystem.

## Evidence Bundle

Evidence is sanitized, deterministic, serializable, immutable, and limited to IDs, versions, timestamps, decisions, transitions, synthetic result metadata, cleanup/rollback status, blocking reasons, and safety flags.

It never includes audio, raw transcript text, provider responses, configuration payloads, secrets, tokens, headers, URLs, personal data, or raw request payloads.

## Report

Allowed decisions:

- `NO_GO`
- `READY_FOR_NEXT_SYNTHETIC_REVIEW`
- `CLEANUP_REQUIRED`
- `ROLLBACK_REQUIRED`

Reports never return production, real-provider, or real-execution decisions.

## Cleanup And Rollback

Cleanup invalidates unused authorization, transitions the session to `cleaned_up`, clears synthetic transient state, preserves sanitized history, and performs no external effects.

Rollback is idempotent, transition-ID protected, preserves history, produces sanitized audit, and never represents rollback of a real operation.

## Timeout

Temporal logic accepts `now` or an injected `clock`. No persistent timers are created.

Covered cases include session expiration before preflight, expiration after preflight, authorization expiration, consent and approval expiration between checks, session expiration during simulation, cleanup after expiration, and rollback after timeout.

## Safety Guarantees

All paths preserve:

- `simulated: true`
- `executed: false`
- `real_provider_called: false`
- `external_network_called: false`
- `can_trigger_real_execution: false`
- `rollout_percentage: 0`
- `production_blocked: true`

## Remaining Risks

A future PR must still define operational ownership, production policy, real provider selection, authorized secret handling, secure upload boundaries, storage/deletion semantics, monitoring, and runtime integration. None of those are enabled here.
