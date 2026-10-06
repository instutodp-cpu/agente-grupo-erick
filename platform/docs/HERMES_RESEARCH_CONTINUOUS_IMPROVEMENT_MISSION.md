# Hermes Research & Continuous Improvement (RCI) Mission

Status: active mission contract
Mode: evidence-first, simulation-first, fail-closed
Parent mission: Hermes Self-Audit & Readiness
Merge authority: human only

## Objective

Establish one transversal Research & Continuous Improvement capability for Hermes that continuously discovers, verifies, scores, experiments on and proposes improvements for every business domain and for Hermes itself.

RCI is not a new autonomous agent and is not a second orchestrator. Maestro remains the Control Plane and Hermes remains the Execution Plane.

## Reuse before creation

RCI MUST reuse existing primitives before adding new ones:
- Hermes self-audit and readiness evidence ladder;
- runtime scheduler contracts and policies;
- simulation/runtime boundaries;
- orchestrator approval and Mission Gateway boundaries;
- audit/evidence infrastructure;
- bounded maintainer A2 repository workflow;
- Marketing research contracts, policy, skill and eval patterns as domain-proven reference material.

Marketing research remains Marketing-specific. RCI may generalize reusable semantics but MUST NOT silently change Marketing contracts.

## Continuous loop

observe -> discover -> verify -> deduplicate -> score -> relate_to_domain -> propose -> simulate -> evaluate -> recommend -> authorized_implementation -> test -> measure -> learn

A finding is never implementation authority.

## Research scopes

RCI supports:
- domain_radar: research relevant to a registered business domain;
- hermes_radar: architecture, models, tools, dependencies, security, reliability, observability, cost and maintainability;
- process_radar: bottlenecks, recurring failures, manual work and process improvement;
- strategy_radar: evidence-backed strategic opportunities;
- dependency_radar: provider/API/SDK/model changes;
- readiness_radar: capabilities stalled or inconsistent across planned/contracted/implemented/tested/proven_e2e/operational;
- incident_triggered: research initiated from a material failure or regression.

## Scheduling policy

RCI uses the existing scheduler family. It MUST NOT create one independent cron implementation per domain.

Scheduling is policy-driven and may materialize:
- lightweight daily rotating radar;
- daily dependency/provider watch where justified;
- weekly deep research;
- weekly capability/readiness review;
- event-triggered research from incidents, regressions, material cost/latency changes or stale evidence.

Cadence is configuration, not hard-coded domain logic. Duplicate queries and unchanged evidence should be suppressed by fingerprint/currentness rules.

## Evidence requirements

Every research finding must preserve:
- source identity and retrieval time;
- source class and trust assessment;
- domain/scope relevance;
- claim/evidence separation;
- currentness window;
- deduplication fingerprint;
- confidence;
- expected value;
- implementation/risk/cost estimate when available;
- contradictory evidence when found;
- provenance to any experiment or proposal created from the finding.

Unverified discovery MUST NOT be represented as fact.

## Improvement scoring

Candidates are ranked from explicit dimensions rather than intuition alone:
- expected business/technical value;
- evidence confidence;
- urgency/currentness;
- risk reduction;
- implementation cost;
- operational risk;
- reversibility;
- dependency impact.

The score prioritizes investigation; it does not authorize execution.

## Experiment bridge

High-value candidates should progress through bounded experiments when feasible:
baseline -> candidate -> simulation/eval -> evidence comparison -> recommendation.

RCI MUST preserve failed and negative experiments to reduce repeated research and survivorship bias.

## Mission generation

RCI may automatically prepare an A1/A2 mission candidate when evidence and policy thresholds are met. A generated mission must contain objective, scope, evidence, expected value, risks, acceptance criteria, rollback/reversibility and protected boundaries.

Mission generation does not grant A3/A4 authority.

## Authority

Autonomous:
- research;
- read-only observation;
- evidence collection;
- deduplication and scoring;
- hypotheses;
- simulation and evals;
- recommendations;
- A2 repository development only through already-authorized bounded maintainer contracts.

Protected:
- merge to main;
- production publication;
- spend or financial mutation;
- customer/external messaging;
- destructive action;
- secret/permission changes;
- autonomous expansion of Hermes authority.

`merge_authority:false` and `human_merge_required:true` remain invariant.

## Initial increments

1. RCI-01 contract and registry foundation.
2. RCI-02 research finding/evidence and source registry.
3. RCI-03 scheduler policy and rotating/event-triggered research plans.
4. RCI-04 source intelligence/currentness/trust.
5. RCI-05 findings store, provenance and evidence graph.
6. RCI-06 scoring, deduplication and prioritization.
7. RCI-07 domain radar.
8. RCI-08 Hermes infrastructure/self-evolution radar.
9. RCI-09 experiment/eval bridge.
10. RCI-10 improvement proposals.
11. RCI-11 bounded mission-candidate generation.
12. RCI-12 learning/feedback loop.
13. RCI-13 controlled E2E proving research -> proposal -> experiment -> Draft PR, stopping before protected authority.

## RCI-01 acceptance

RCI-01 is complete only when:
- this transversal contract exists;
- a machine-readable registry declares scope and authority;
- tests prove RCI is not a new agent/orchestrator;
- tests prove protected actions remain denied;
- tests prove reuse references exist for self-audit, scheduler, simulation and Marketing research;
- CI executes the RCI foundation tests.
