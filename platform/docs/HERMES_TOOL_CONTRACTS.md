# Hermes Agent Core - Tool Contracts

## Objetivo

This document defines the declarative tool contracts of the Hermes Agent Core: how a tool is represented, validated, classified, permissioned, costed, audited, and registered — with no tool ever executed, no HTTP call, no MCP, no API, no database, and no filesystem access.

**Esta implementação define apenas contratos declarativos de ferramentas. Nenhuma ferramenta é executada, nenhuma API é chamada e nenhum efeito colateral ocorre.**

## Categorias

`tool-contract.js` declares 11 `category` values: `LOCAL_REFERENCE`, `HTTP_REFERENCE`, `DATABASE_REFERENCE`, `MCP_REFERENCE`, `LLM_REFERENCE`, `FILESYSTEM_REFERENCE`, `MESSAGE_REFERENCE`, `EMAIL_REFERENCE`, `CALENDAR_REFERENCE`, `SEARCH_REFERENCE`, `CUSTOM_REFERENCE`. These are pure classifications of what *kind* of tool a reference represents — they carry no connection, no credential, and no executable behavior. `tool_status` (`DRAFT`, `VALIDATED_SIMULATION`, `DEPRECATED_REFERENCE`, `ARCHIVED`) is likewise a declarative lifecycle label; statuses implying real activation (`ACTIVE`, `CONNECTED`, `ENABLED`, `LIVE`, `PRODUCTION`, `AUTHENTICATED`) are structurally forbidden.

## Capabilities

`tool-capability-contract.js` represents what a tool *could* do, declaratively, as an ordered, unique, non-empty subset of 11 `capabilities`: `READ_REFERENCE`, `WRITE_REFERENCE`, `UPDATE_REFERENCE`, `DELETE_REFERENCE`, `EXECUTE_REFERENCE`, `SEARCH_REFERENCE`, `GENERATE_REFERENCE`, `CLASSIFY_REFERENCE`, `SUMMARIZE_REFERENCE`, `ROUTE_REFERENCE`, `VALIDATE_REFERENCE`. A capability set is a label, never an invocation — no capability in this PR is ever exercised.

## Permissões

`tool-permission-contract.js` declares 8 boolean permission flags: `requires_confirmation`, `requires_human_review`, `requires_network`, `requires_secret`, `requires_filesystem`, `requires_database`, `requires_external_provider`, `requires_runtime`. These flags describe what a *future* orchestration layer would need to check before ever invoking the tool — they do not grant, request, or exercise any of those capabilities themselves. Every permission set is forced `simulation=true`/`production_blocked=true`.

## Custos

`tool-cost-contract.js` declares a `cost_tier` reference: `ZERO_COST_REFERENCE`, `VERY_LOW`, `LOW`, `MODERATE`, `HIGH`, `UNKNOWN_BLOCKED`. This is a coarse, declarative cost classification only — no real currency amount, no billing unit, and no cost is ever computed or consumed in this PR.

## Side Effects

`tool-side-effects-contract.js` declares a `side_effect` reference: `NONE`, `READ_ONLY_REFERENCE`, `STATE_CHANGE_REFERENCE`, `EXTERNAL_EFFECT_REFERENCE`, `IRREVERSIBLE_REFERENCE`. This tells a future orchestrator how carefully a tool's *hypothetical* invocation would need to be gated — it is never evaluated against a real outcome, since no outcome is ever produced in this PR.

## Decisão

`tool-decision.js#buildToolDecision` aggregates a `ToolContract` with its `CapabilitySet`, `PermissionSet`, `CostReference` and `SideEffectReference` into one `ToolDecision` record. It validates each of the five sub-contracts independently, then cross-checks that every sub-contract references the same `tool_id`, `tenant_id` and `organization_id` as the tool itself — a mismatch blocks the whole registration (`TENANT_BLOCKED`/`ORGANIZATION_BLOCKED`) rather than silently registering a partially-inconsistent tool. Any other invalid input degrades to `VALIDATION_FAILED`/`BLOCKED`, mirroring the pattern established in PR #84's `model-selection-decision.js` and PR #87's `context-assembly-result.js`.

## Registry

`tool-registry.js` is a private, in-memory, synthetic registry for tools, capability sets, permission sets, cost references, side effect references and decisions, built on the same replay/payload-mismatch/optimistic-concurrency/fingerprint-conflict/organization-rebinding pattern established in PR #83 and hardened in PR #86. Every stored and returned record is defensively cloned and deep-frozen; nothing is persisted.

## Fingerprints

`stablePayload`/`stableCanonicalize` (reused from PR #79) make every fingerprint a deterministic, key-sorted canonical JSON serialization — not a cryptographic hash. Identical input always produces an identical fingerprint; any change to the payload changes it. `tool-decision.js` computes one independent fingerprint per sub-contract (`tool_fingerprint`, `capability_fingerprint`, `permission_fingerprint`, `cost_fingerprint`, `side_effect_fingerprint`), so a change to any single sub-contract is independently detectable.

## Auditoria

`tool-audit.js` records only the five sub-contract fingerprints, the tenant/organization binding, the decision status, blockers, reason codes — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records a payload, a parameter, a secret, a token, an endpoint, or a response.

## Invariantes

Every `ToolDecision`, regardless of status, forces: `executed=false`, `runtime_enabled=false`, `network_used=false`, `provider_called=false`, `tool_called=false`, `simulation=true`, `production_blocked=true`, `rollout_percentage=0`. Every contract is exact-fields and deny-by-default; an unrecognized enum, a missing field, an extra field, or any detected operational material degrades the decision rather than defaulting permissively.

## Limitações

There is no tool executor, no HTTP client, no MCP client, no database driver, no filesystem access, no LLM/provider SDK, no queue, no worker, no cron, no real timer, no executable callback or handler, no `dynamic import`, no `eval`, and no `Function` constructor anywhere in these modules. A tool's `capabilities`, `requires_*` permissions, `cost_tier` and `side_effect` are declared by whoever registers the tool — this PR does not verify that a declared capability set, permission profile, cost tier or side effect actually matches the tool's real-world behavior; that verification is a future architectural concern.

## Next Steps

**A próxima etapa arquitetural é o Workflow Contracts.**
