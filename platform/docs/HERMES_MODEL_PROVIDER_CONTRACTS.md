# Hermes Agent Core - Model Provider Contracts

## Objective

This document defines the declarative provider and model contracts of the Hermes Agent Core: providers, models, capabilities, modalities, context limits, cost, latency, availability, privacy, health, rate limits, tiers, compatibility, fingerprints, a synthetic registry, an audit trail and simulated eligibility decisions — preparing the future economic model-selection mechanism without connecting to, loading, calling, or authenticating against any real provider.

**Esta implementação define apenas contratos e referências declarativas de providers e modelos. Nenhum provider é conectado, nenhum modelo é carregado ou chamado e nenhum token ou custo é consumido.**

## Provider, Model E Capability

A **provider** (`model-provider-contract.js`) is a declarative envelope describing an organization or runtime that could, in a future implementation, host models — its type (`COMMERCIAL_API_REFERENCE`, `LOCAL_RUNTIME_REFERENCE`, `SELF_HOSTED_REFERENCE`, `OPEN_SOURCE_REFERENCE`, `ENTERPRISE_GATEWAY_REFERENCE`, `AGGREGATOR_REFERENCE`, `SYSTEM_REFERENCE`), its deployment mode, the regions and modalities it declares support for, and four small inline declarative profiles (`privacy_profile`, `availability_profile`, `health_profile`, `rate_limit_profile` — none of them given an explicit field list in the PR #83 specification, so they mirror the shape of their per-model leaf-contract counterparts). A **model** (`model-contract.js`) is a declarative envelope describing a single entry offered by a provider: its tiers (quality/cost/latency/privacy), its declared context window, and references to its capability, pricing, limits, availability and health records. A **capability** (`model-capability-contract.js`) is the most granular declaration: one `capability_type` (text generation, summarization, reasoning, vision, transcription, tool calling, and 11 others), one `support_level`, and purely descriptive quality/latency/cost scores — a capability entry never authorizes a call, a stream, a batch, or a tool invocation. `model.provider_id`/`model.provider_version` must match a registered provider exactly; a mismatch or a stale version is rejected (`CONFLICT_BLOCKED`/`VERSION_BLOCKED`) before anything else is evaluated.

## Quality Tier

Six values: `UTILITY`, `BASIC`, `STANDARD`, `ADVANCED`, `PREMIUM`, `SPECIALIST`. Purely declarative — the eligibility evaluator compares a model's `quality_tier` against a selection reference's `minimum_quality_tier_reference` by rank only, never by calling or scoring anything in real time.

## Cost Tier

Seven values: `ZERO_COST_REFERENCE`, `VERY_LOW`, `LOW`, `MODERATE`, `HIGH`, `PREMIUM`, `UNKNOWN_BLOCKED`. `ZERO_COST_REFERENCE` means only that a cost is *declared* as zero or subsidized — it never guarantees availability, and `UNKNOWN_BLOCKED` always blocks eligibility (`PRICING_BLOCKED`) rather than defaulting to an assumed cost.

## Latency Tier

Six values: `VERY_LOW`, `LOW`, `MODERATE`, `HIGH`, `BATCH_REFERENCE`, `UNKNOWN_BLOCKED`. Compared by rank against a selection reference's `maximum_latency_tier_reference`; no real latency is ever measured anywhere in this PR.

## Privacy Tier

Six values: `PUBLIC_PROCESSING_REFERENCE`, `STANDARD_PROCESSING_REFERENCE`, `NO_TRAINING_REFERENCE`, `PRIVATE_GATEWAY_REFERENCE`, `LOCAL_PROCESSING_REFERENCE`, `RESTRICTED_BLOCKED`. `RESTRICTED_BLOCKED` is a member of the enum for completeness but is always rejected wherever a model or a selection requirement declares it — it can never be eligible. A `data_classification=RESTRICTED` selection reference is always `PRIVACY_BLOCKED`, independent of the model's own privacy tier.

## Pricing Reference

`model-pricing-contract.js` declares currency, billing unit (`TOKEN_REFERENCE`, `REQUEST_REFERENCE`, `IMAGE_REFERENCE`, `AUDIO_MINUTE_REFERENCE`, `ZERO_COST_REFERENCE`, `MIXED_REFERENCE`) and every monetary field as a bounded non-negative integer in minor units — never a float. `pricing_verified` is always `false` in this PR. The eligibility evaluator compares `input_cost_minor_units_per_million` against a selection reference's `maximum_cost_minor_units_reference` and blocks (`PRICING_BLOCKED`) when the declared cost exceeds the requested ceiling, or when the model's `cost_tier` is `UNKNOWN_BLOCKED`. `free_tier_available_reference` never guarantees future gratuity.

## Limits Reference

`model-limits-contract.js` declares context/input/output token ceilings and rate-limit-shaped references (requests/tokens per minute, concurrency, batch size, file size, images per request, audio seconds) as bounded non-negative integers — `NaN` and `Infinity` are rejected outright, and `limits_verified` is always `false`. The eligibility evaluator blocks when a selection reference's requested input, output, or combined context need exceeds the declared limit or the model's own `context_window_tokens` (`LIMIT_BLOCKED`). No real rate limit is ever consulted or consumed.

## Availability

`model-availability-contract.js` declares an `availability_status` (`AVAILABLE_REFERENCE`, `DEGRADED_REFERENCE`, `UNAVAILABLE_REFERENCE`, `UNKNOWN_BLOCKED`), a sorted/deduplicated `region_references` list, and tenant/organization/quota/capacity booleans — never a proven operational fact. `availability_verified` is always `false`; anything other than `AVAILABLE_REFERENCE` blocks eligibility (`AVAILABILITY_BLOCKED`).

## Health

`model-health-contract.js` declares a `health_status` (`HEALTHY_REFERENCE`, `DEGRADED_REFERENCE`, `UNHEALTHY_REFERENCE`, `UNKNOWN_BLOCKED`), latency/error-rate/success-rate references, and a `capacity_status_reference` — `health_verified`, `network_checked` and `provider_called` are always `false`. `UNHEALTHY_REFERENCE` and `UNKNOWN_BLOCKED` both block eligibility (`HEALTH_BLOCKED`); no real health check is ever performed.

## Model Selection Reference

`model-selection-reference.js` declares what a future selection *would* look for — task type, complexity tier, risk/data classification, required capabilities, preferred modalities, cost/token/latency/quality/privacy ceilings, and preference flags (`free_or_low_cost_preferred`, `local_preferred`, `fallback_allowed_reference`, `escalation_allowed_reference`) that are purely descriptive in this PR and never drive an actual fallback or escalation. `selection_requested` is always `true`, `selection_executed` is always `false`, and `selected_provider_id`/`selected_model_id` are always `null` — **no model is ever selected in this PR.**

## Registry

`model-provider-registry.js` is a private, in-memory, synthetic registry built on a shared `createEntityStore` factory reused across all eight entity types (provider, model, capability, pricing, limits, availability, privacy, health) to avoid duplicating replay/conflict/versioning logic. It supports lookup by id, tenant-scoped listing with filters (organization, provider, quality tier, cost tier, privacy tier, modality, capability type), replay protection, payload-mismatch detection, optimistic concurrency (`expected_version`), an independent fingerprint check (`expected_fingerprint`), version-downgrade rejection, tenant/organization reassignment blocking, and cross-store referential checks (a model cannot be registered before its provider; a capability/pricing/limits/availability/privacy/health record cannot be registered before both its provider and its model). It stores no secret, API key, real endpoint, token, SDK client, function, callback, handler, operational instance, connection, or user payload — every stored and returned record is defensively cloned and deep-frozen.

## Fingerprints

`stablePayload`/`stableCanonicalize` (reused from PR #79) make every fingerprint a deterministic, key-sorted canonical JSON serialization — not a cryptographic hash. The same provider or model evaluated twice produces an identical fingerprint; changing any field changes it. This backs both the registry's replay/conflict detection and the decision evaluator's reproducibility.

## Tenant Isolation

Every provider and model carries `tenant_id`/`organization_id`, with `organization_id` required to be namespaced under `tenant_id` (`"<tenant_id>:..."`). The decision evaluator checks the provider's and the model's tenant/organization binding against the caller's expected binding before validating anything else, and the registry never lists or reassigns a record across tenants or organizations.

## Auditoria

`model-provider-audit.js` records only fingerprints (provider, model, capabilities, pricing, limits, availability, privacy, health, selection reference), tenant/organization bindings, provider type, quality/cost/latency/privacy tier, decision status, blockers, reason codes and a logical sequence — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records a real external price, a secret, a token, an endpoint, a credential, a prompt, user content, a model response, a full payload, code, a function, a callback, or a handler.

**Referências de preço, disponibilidade, saúde, privacidade e limites não são verificadas externamente nesta implementação.**

## Fail-Closed

Every contract is exact-fields and deny-by-default: an unrecognized enum, a missing or extra field, a forbidden status (`ACTIVE`, `CONNECTED`, `AUTHENTICATED`, `LIVE`, `PRODUCTION`, `ENABLED` for providers; `ACTIVE`, `LOADED`, `RUNNING`, `SERVING`, `CONNECTED`, `ENABLED` for models), or any detected operational material blocks validation before a decision is even attempted. The eligibility evaluator only ever returns `eligible_in_simulation=true` when every referenced contract validates and no blocker fired — and even then, `model_selected`, `provider_called`, `network_used`, `tokens_consumed`, `cost_consumed`, `executed` and `runtime_enabled` remain `false`.

**A arquitetura prepara o Hermes para escolher futuramente entre execução sem LLM, modelos gratuitos, locais, econômicos, intermediários e avançados conforme capacidade, custo, risco, privacidade e disponibilidade.**

## Limitações

There is no OpenAI/Anthropic/Google/Ollama/OpenRouter/Groq/Together/Hugging Face SDK or any other real provider client, no HTTP, no WebSocket, no DNS, no real endpoints, no secrets, no API keys, no `process.env`, no real billing or tokenization, no model call, no text generation, no tool calling, no embeddings, no audio or image processing, no network, no real runtime, no operational cache, no queues, no workers, no cron, no persistence, no database, no `dynamic import`, no `eval`, no `Function`, and no executable callback or handler anywhere in these modules.

## Next Steps

**A próxima etapa arquitetural é o Model Selection Engine.**
