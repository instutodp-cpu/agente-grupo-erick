# Hermes Core - Transcription Runtime Registration Boundary

## Objective

This document defines the simulated runtime registration boundary that closes the architectural preparation phase of the transcription module. Every future path that could register, load, initialize, activate or otherwise attach a component (provider adapter, capability profile, selection engine, secret boundary, network boundary, transport reference, mock orchestrator, audit component, validation component or runtime policy) to the Hermes runtime must pass through this boundary first.

## Threat Model

Registration requests, component descriptors and dependency graphs are untrusted. The boundary rejects executable entrypoint references (imports, requires, dynamic imports, callbacks, handlers, filesystem paths, package names, module names, URLs, code, functions, bootstrap or startup references), invalid dependency graphs (cycles, self-references, orphan dependencies, duplicates, version incompatibilities) and any operational network material leaking through free-form metadata. It is deterministic, audit-only and fail-closed.

## Registration Request

A runtime registration request binds tenant, conversation, environment, a single component descriptor, a dependency graph, an optional sanitized secret-resolution context, an optional sanitized network-permission context and a policy context. Exact fields are required and the payload is canonically fingerprinted before review.

## Component Descriptors

A component descriptor identifies a component type (from the fixed `COMPONENT_TYPES` list), a logical component id and a purely symbolic entrypoint reference. It must explicitly report that it is not active, registered, initialized or activated. It remains simulated, runtime-disabled and production-blocked. The entrypoint reference is validated against a strict symbolic format and an explicit deny list; nothing resembling an import, a filesystem path, a URL, code or a bootstrap/startup hook is accepted.

## Dependency Graph

The dependency graph declares nodes, edges, bindings and a topological order. Nodes must be unique and versioned; edges must reference declared nodes and must not be self-referential; bindings must reference declared nodes and their declared version. Cycles, self-references, orphan dependencies, duplicate nodes/edges and version-incompatible bindings are all rejected. The submitted topological order must match the canonical order computed from the graph.

## Registration Policy

The policy validates actor, role, tenant, environment, purpose and review states (security, architecture, runtime) and is deny-by-default. `REGISTRATION_SIMULATION_REVIEWED` means only that the blocked request was reviewed for simulation. It does not allow registration. Allowed result statuses are `REGISTRATION_SIMULATION_REVIEWED`, `REGISTRATION_DENIED`, `REGISTRATION_POLICY_BLOCKED`, `COMPONENT_GRAPH_BLOCKED` and `VALIDATION_FAILED`.

## Secret And Network Boundary Integration

The boundary may receive sanitized output forwarded from the secret-resolution boundary and the network-permission boundary. It requires the same fail-closed shape those boundaries already enforce (no secret material, no network access, `simulation=true`, `production_blocked=true`). Neither context ever unlocks registration, initialization or activation.

## Registration Plan

The registration plan is an inert artifact: it records the component identity, entrypoint reference, computed dependency order and binding count under the same fail-closed flags as the result. It is never used to register, load, initialize or activate anything.

## Fail-Closed Invariants

Every result preserves `registration_allowed=false`, `runtime_mutated=false`, `components_registered=false`, `components_initialized=false`, `components_activated=false`, `network_used=false`, `provider_called=false`, `secret_loaded=false`, `executed=false`, `simulation=true`, `production_blocked=true`, `runtime_enabled=false` and `rollout_percentage=0`.

**Nenhum componente é carregado, registrado, inicializado, ativado ou conectado ao runtime por esta implementação.**

## Orchestrator Integration

Provider selection, secret resolution and network permission review may feed a synthetic registration request into this boundary, but none of those steps imply registration. The mock orchestrator records `runtime_registration`, `runtime_registration_policy_decision` and `runtime_registration_plan_fingerprint` metadata only when a registration request is supplied. Existing mock flows continue to work without one.

## Audit

Audit records include only fingerprints, tenant/environment/component bindings, blockers, decision, sequence and versions. They never include code, payload, secrets, endpoints, callbacks, handlers or real filesystem paths.

## Limitations

Nenhum componente é registrado, carregado, inicializado ou ativado por esta implementação. There is no runtime mutation, no bootstrap change, no SDK, no provider integration and no filesystem or environment secret lookup.

**Esta implementação encerra a fase de preparação arquitetural do módulo de transcrição. A ativação operacional permanece adiada até existir necessidade real do produto.**

## Next Steps

A future PR would require an explicit, separately reviewed operational activation model with concrete non-production controls, runtime gating and dedicated provider contract updates before any component could be registered, loaded, initialized or activated for real.
