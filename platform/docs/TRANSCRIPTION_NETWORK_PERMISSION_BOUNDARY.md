# Hermes Core - Transcription Network Permission Boundary

## Objective

This document defines the simulated network permission boundary for future transcription provider work. Every future path that could resolve DNS, open sockets, create connections, attempt TLS, send HTTP, use WebSocket, stream data, call an SDK or contact a provider must pass through this boundary first.

## Threat Model

All network requests and destination references are untrusted. The boundary rejects operational addresses, URL-like values, hostnames, IP addresses, ports, sockets, proxies, tunnels, authorization metadata, credentials and unsafe state flags. It is deterministic, audit-only and fail-closed.

## Network Request

A network permission request binds tenant, provider, adapter, transport, operation, protocol, data classification, synthetic destination, optional secret-resolution context and policy context. Exact fields are required and the payload is canonically fingerprinted before review.

## Destination Reference

Destination references are synthetic metadata only. They must explicitly report that no endpoint, hostname, IP, port or URL is present. They remain inactive, unapproved, simulated, network-disabled and production-blocked.

## Network Policy

The policy validates actor, role, tenant, operation, protocol, data classification, purpose and review states. `NETWORK_SIMULATION_REVIEWED` means only that the blocked request was reviewed for simulation. It does not allow network access.

## Secret Boundary Integration

The boundary may receive sanitized output from the secret-resolution boundary. It requires `secret_material_present=false`, `secret_material_returned=false`, `secret_loaded=false`, `secret_resolved=false`, `simulation=true` and `production_blocked=true`. A valid secret reference never unlocks network access.

## Provider Selection And Orchestrator

Provider selection may feed a synthetic request into this boundary, but selection never implies network authorization. The mock orchestrator records network permission metadata only when supplied. Existing mock flows continue to work without a network request.

## Fail-Closed Invariants

Every result preserves `network_allowed=false`, `dns_attempted=false`, `socket_created=false`, `connection_opened=false`, `tls_attempted=false`, `request_sent=false`, `stream_opened=false`, `response_received=false`, `network_used=false`, `provider_called=false`, `executed=false`, `simulation=true`, `production_blocked=true`, `runtime_enabled=false` and `rollout_percentage=0`.

## Audit

Audit records include only fingerprints, bindings, protocol, operation, classification, blockers, decision, sequence and versions. They do not include URLs, domains, hosts, IP addresses, ports, headers, tokens, secrets, audio payloads, transcripts or authorization values.

## Limitations

Nenhuma resolucao DNS, criacao de socket, conexao, requisicao, stream ou comunicacao externa e realizada por esta implementacao. There is no SDK, provider integration, endpoint configuration, runtime registration, filesystem access or environment secret lookup.

## Next Steps

A future PR may design a non-operational allowlist review model. Actual network enablement would require separate explicit review, concrete non-production controls, runtime gating and dedicated provider contract updates.
