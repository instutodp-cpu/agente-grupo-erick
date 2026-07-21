# Hermes Core - Transcription Secret Resolution Boundary

## Objective

This document describes the simulated secret resolution boundary for future transcription providers. The boundary validates requests, references and access policy, then returns only sanitized metadata. It never reads, stores, decrypts, resolves or returns real secret material.

## Threat Model

The boundary treats every caller payload as untrusted. It rejects missing fields, extra fields, provider or tenant mismatches, unsafe flags, revoked references, active references and suspicious secret-like material. The design is fail-closed: every error produces a blocked simulated result.

## Secret Reference

A secret reference is metadata only. It can describe a future reference type such as `API_KEY_REFERENCE`, `OAUTH_REFERENCE`, `SERVICE_ACCOUNT_REFERENCE`, `SIGNING_KEY_REFERENCE`, `WEBHOOK_SECRET_REFERENCE` or `CUSTOM_REFERENCE`, but it cannot contain any credential value. In this PR all references remain inactive, simulated and production blocked.

## Access Policy

The access policy validates actor type, role, tenant, provider, scope, purpose and approval state. `ACCESS_SIMULATION_APPROVED` means only that reference metadata is structurally acceptable for review. It does not authorize secret loading or provider execution.

## Simulated Registry

The registry stores only synthetic secret references without material. It uses canonical fingerprints, replay protection, payload mismatch detection, optimistic concurrency, version checks, defensive cloning and deep freezing. It has no persistence and no runtime registration.

## Result And Audit

Resolution results always preserve:

- `secret_material_present=false`
- `secret_material_returned=false`
- `secret_loaded=false`
- `secret_decrypted=false`
- `secret_resolved=false`
- `network_used=false`
- `provider_called=false`
- `executed=false`
- `simulation=true`
- `production_blocked=true`
- `runtime_enabled=false`
- `rollout_percentage=0`

Audit records contain only fingerprints, IDs, provider binding, tenant binding, scope binding, decision, blockers and versions. They do not include credential material, raw payloads, authorization headers or sensitive values.

## Optional Integration

The mock transcription orchestrator may receive a synthetic `secret_resolution_request`. When present, the orchestrator records only the sanitized decision, policy metadata and reference fingerprint in the execution context and audit. Existing mock flows continue to work without any secret reference.

## Prohibited Material

The implementation rejects field names and values that look like secrets, tokens, passwords, credentials, API keys, private keys, authorization headers, bearer tokens, JWTs, basic authorization or long opaque key strings. The rejected value is never logged.

## Limitations

This PR does not integrate Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Doppler, 1Password, KMS, HSM, databases, local files, `process.env` or real providers. No secret is read, stored, resolved, decrypted or returned.

## Next Steps

A future PR may define a transport-specific review contract for secret providers. That future work must still preserve fail-closed behavior until an explicitly reviewed, non-production integration is approved.
