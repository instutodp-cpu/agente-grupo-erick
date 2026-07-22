# Hermes Agent Core - Model Selection Engine

## Objective

This document defines the deterministic model selection engine of the Hermes Agent Core: it evaluates declarative task, agent, policy, budget, privacy, capability and candidate-entry references to produce a simulated selection decision, with no real provider called, no model executed, and no token or cost consumed.

**O motor seleciona, em simulação, a alternativa elegível de menor custo capaz de atender aos requisitos obrigatórios da tarefa.**

## Fluxo De Seleção

`model-selection-engine.js` runs a fixed, ordered strategy:

1. verify whether a deterministic, no-LLM resolution is possible
2. filter out structurally incompatible candidates (tenant, organization, version, fingerprint)
3. apply policy and hard blocks (`policy_decision_reference`, `RESTRICTED` risk, budget reference)
4. validate capability coverage
5. validate context (window, input, output, total)
6. validate privacy compatibility
7. validate declarative availability and health
8. validate budget
9. compute a deterministic score per candidate
10. order candidates
11. select the eligible candidate of lowest cost that meets every minimum
12. produce a declarative fallback/escalation plan

Whole-request blocks (invalid request shape, policy deny, `RESTRICTED` risk, budget reference not within budget, or a task estimate that exceeds the operator's constraint ceilings) short-circuit before any candidate is built or scored — **políticas sempre prevalecem sobre score** and a `DENY`-equivalent block can never be overridden by a higher score.

## NO_LLM First

**Execução determinística sem LLM tem prioridade quando disponível e compatível.**

`model-selection-candidate.js` can construct a synthetic `NO_LLM` candidate (`provider_id=null`, `model_id=null`, `estimated_cost_minor_units=0`, `zero_cost_reference=true`, `local_reference=true`) whenever `constraints.allow_no_llm=true`, `task_profile.deterministic_resolution_available=true`, `task_profile.complexity_tier=TIER_0_DETERMINISTIC`, no capability, modality, tool-calling or long-context requirement is declared. When eligible, `NO_LLM` always ranks ahead of every other candidate. No deterministic executor is ever invoked in this PR — the candidate is a declarative placeholder only.

## Seleção Econômica

**Modelos gratuitos, locais e econômicos são preferidos, mas nunca podem superar requisitos obrigatórios de capacidade, qualidade, risco, privacidade, contexto ou política.**

`model-selection-ranking.js` orders eligible candidates by: eligibility, `NO_LLM` priority, cost tier, declared cost amount, capability breadth, quality, privacy, latency, availability, health, and local preference — always with the candidate's `model_id` (or `candidate_id` for `NO_LLM`) as the final, canonical, deterministic tie-breaker. Input array order never influences the result. A cheaper candidate only loses to a more expensive one when it fails a mandatory filter (quality, capability, context, privacy, availability, health, or budget) first — the mandatory filters run in `model-selection-engine.js` before scoring or ranking ever sees the candidate.

## Filtros Obrigatórios

Every candidate is resolved to a `candidate_status` (`ELIGIBLE_SIMULATION`, `INELIGIBLE`, `POLICY_BLOCKED`, `CAPABILITY_BLOCKED`, `CONTEXT_BLOCKED`, `PRIVACY_BLOCKED`, `AVAILABILITY_BLOCKED`, `HEALTH_BLOCKED`, `BUDGET_BLOCKED`, `VERSION_BLOCKED`, `TENANT_BLOCKED`, `ORGANIZATION_BLOCKED`) before scoring. Tenant/organization mismatch, an incompatible `candidate_model_references` version or fingerprint, insufficient capability or modality coverage, quality below the minimum, insufficient context window/input/output capacity, a privacy tier weaker than required, an unavailable/unknown availability or health status, a cost above the budget ceiling, or an unknown cost tier all block a candidate outright — none of these degrade a score, they remove the candidate from consideration entirely.

## Scoring

`model-selection-score.js` computes 12 bounded integer components (`capability_score`, `quality_score`, `cost_score`, `latency_score`, `privacy_score`, `availability_score`, `health_score`, `context_fit_score`, `locality_score`, `zero_cost_score`, `policy_score`, plus `eligibility_score`) and 2 integer penalties (`risk_penalty`, `unknown_data_penalty`) — no floats, no randomness, no machine learning, no external calls. Lower declared cost increases `cost_score`; a `zero_cost_reference` entry receives a bonus; a `local_reference` entry receives a bonus when locality is allowed; a stronger privacy tier receives a bonus. `total_score` is forced to `0` whenever `eligibility_score=0` — an insufficient capability, context, or quality **blocks**, it does not merely lower the score. The score is deterministic and reproducible for identical input, and is informational only: it never overrides the explicit multi-key ranking comparator or a policy block.

## Ranking

`model-selection-ranking.js` partitions candidates into `eligible_candidate_ids`/`ineligible_candidate_ids`, produces a totally ordered `ordered_candidate_ids`, and designates `primary_candidate_id` (the winning candidate, or a `NONE_ELIGIBLE_SIMULATION` sentinel when nothing is eligible), `fallback_candidate_ids` and `escalation_candidate_ids` (bounded by `constraints.maximum_fallbacks`/`maximum_escalations`). `ranking_generated=true` and `selection_executed=false` always.

## Desempate

When every ranking criterion ties, the comparator falls back to the candidate's `model_id` (lexicographic ascending), or `candidate_id` for `NO_LLM`. This is recorded on the ranking as `tie_breaker_applied`/`tie_breaker_reason`. Input order is never used as a tie-breaker.

## Orçamento

`model-selection-constraints.js` declares `maximum_cost_minor_units` (an integer ceiling in minor units, never a float) alongside `maximum_input_tokens`/`maximum_output_tokens`/`maximum_total_tokens`. A candidate whose `estimated_cost_minor_units` exceeds the ceiling, or whose `cost_tier` is `UNKNOWN_BLOCKED`, is `BUDGET_BLOCKED`. The request also carries a `budget_reference` (a minimal declarative pointer, not the full budget decision) whose `within_budget_reference=false` blocks the entire request before any candidate is evaluated.

## Privacidade

A candidate's `privacy_tier` is compared by rank against `constraints.required_privacy_tier`; a weaker tier is `PRIVACY_BLOCKED`. `RESTRICTED_BLOCKED` can never be eligible and can never be requested as a requirement — the contract rejects it outright wherever it appears. `data_classification=RESTRICTED` on the task profile always blocks the whole request (see Risco).

## Risco

`task_profile.risk_classification=RESTRICTED` always blocks the request (`RISK_BLOCKED`) before any candidate is built. `risk_classification=HIGH`, and `complexity_tier=TIER_5_CRITICAL`, both require `minimum_quality_tier` to be at least `ADVANCED` — enforced directly by `model-selection-task-profile.js`, never inferred silently. `TIER_5_CRITICAL` additionally requires `human_review_required=true`; `TIER_0_DETERMINISTIC` requires `deterministic_resolution_available=true`.

## Contexto

A task profile's `estimated_input_tokens`/`estimated_output_tokens`/`estimated_total_tokens` must fit under the operator's `constraints` ceilings (checked once, at the whole-request level) and under each candidate's own declared `context_window_tokens`/`maximum_input_tokens`/`maximum_output_tokens` (checked per candidate, `CONTEXT_BLOCKED` on failure).

## Fallback

`model-selection-escalation-plan.js` records `fallback_candidate_ids` (the next-best eligible candidates after the primary, bounded by `maximum_fallbacks`) purely as a declarative reference list. `fallback_executed=false` always in this PR.

## Escalonamento

The same plan records `escalation_candidate_ids` (bounded by `maximum_escalations`) and `escalation_trigger_references` drawn from a fixed 9-value enum (`VALIDATION_FAILURE_REFERENCE`, `QUALITY_THRESHOLD_FAILURE_REFERENCE`, `STRUCTURED_OUTPUT_FAILURE_REFERENCE`, `CAPABILITY_FAILURE_REFERENCE`, `TIMEOUT_REFERENCE`, `PROVIDER_UNAVAILABLE_REFERENCE`, `HEALTH_DEGRADED_REFERENCE`, `CONTEXT_LIMIT_REFERENCE`, `HUMAN_REVIEW_REFERENCE`) — these are references to *future* triggers, never a timeout or a real invocation. `escalation_executed=false` always in this PR.

**Nenhum provider ou modelo é chamado nesta implementação. Nenhum token, custo, fallback ou escalonamento é consumido ou executado.**

## Registry

`model-selection-registry.js` is a private, in-memory, synthetic registry for task profiles, constraints, candidates, rankings, decisions and escalation plans, built on the same replay/payload-mismatch/optimistic-concurrency/fingerprint-conflict pattern established in PR #83's registry. Entities without a natural version field (constraints, ranking, decision, escalation plan) fall back to replay-or-payload-mismatch semantics rather than numeric version comparison. Constraints have no identity field of their own, so they are registered under a caller-supplied key (typically the `selection_request_id`). Every stored and returned record is defensively cloned and deep-frozen.

## Fingerprints

`stablePayload`/`stableCanonicalize` (reused from PR #79) make every fingerprint a deterministic, key-sorted canonical JSON serialization — not a cryptographic hash. Identical input always produces identical fingerprints; any change to the payload changes it. This backs both the registry's replay/conflict detection and the decision's own reproducibility.

## Auditoria

`model-selection-audit.js` records only fingerprints (request, task profile, constraints, candidates, ranking, decision, escalation plan), tenant/organization bindings, task type, complexity tier, risk classification, data classification, the selected candidate id, the selected cost tier, the estimated cost in minor units, whether the decision was `NO_LLM` or a model reference, blockers, reason codes and a logical sequence — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records a prompt, user content, a response, a secret, an endpoint, an API key, a full payload, code, a callback, or a handler.

## Fail-Closed

Every contract is exact-fields and deny-by-default. `selection_evaluated=true` always; `model_selected_in_simulation` can only be `true` when `status=MODEL_SELECTED_SIMULATION`. `provider_called`, `model_called`, `network_used`, `tokens_consumed`, `cost_consumed`, `fallback_executed`, `escalation_executed`, `executed` and `runtime_enabled` are forced `false` on every decision, regardless of status. An invalid request, an unrecognized enum, or any detected operational material degrades the decision to `VALIDATION_FAILED`/`BLOCKED` rather than defaulting permissively.

## Limitações

There is no OpenAI/Anthropic/Gemini/Ollama/OpenRouter/Groq/Together/Hugging Face SDK or any other real provider client, no HTTP call, no real endpoint, no secret, no API key, no `process.env`, no real tokenization or billing, no model execution, no text generation, no streaming, no tool calling, no embeddings, no RAG, no database, no filesystem, no operational cache, no queues, no workers, no cron, no real timers, no executable callback or handler, no `dynamic import`, no `eval`, and no `Function` constructor anywhere in these modules.

## Next Steps

**A próxima etapa arquitetural é o Context Assembly Engine.**
