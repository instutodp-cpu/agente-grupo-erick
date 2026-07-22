# Hermes Agent Core - Workflow Contracts

## Objetivo

This document defines the declarative workflow contracts of the Hermes Agent Core: how a workflow, its steps, their dependencies, conditions, retries, timeouts, compensations and approvals are represented, validated, registered and audited — with no workflow ever executed, no tool called, no provider called, no model called, and no network used.

**Esta implementação define apenas contratos declarativos de workflow. Nenhum workflow ou etapa é executado.**

## Workflow

`workflow-contract.js` declares the 17 mandatory fields of a `Workflow`: `workflow_id`, `workflow_version`, `tenant_id`, `organization_id`, `display_name`, `description`, `status`, `step_references`, `entry_conditions`, `exit_conditions`, `approval_policy_reference`, `timeout_reference`, `retry_reference`, `compensation_reference`, `simulation_context`, `logical_sequence`, `validator_version`. `step_references` is a non-empty, unique, author-declared list of step ids — the set of steps that belong to the workflow, never their real content. `status` accepts only `DRAFT`, `VALIDATED_SIMULATION`, `SUSPENDED`, `ARCHIVED`; statuses implying real execution (`RUNNING`, `EXECUTING`, `ACTIVE`, `LIVE`) are structurally forbidden. `approval_policy_reference`, `timeout_reference`, `retry_reference` and `compensation_reference` are the workflow's required defaults — every step may declaratively override any of them individually.

## Steps

`workflow-step-contract.js` declares the 20 fields of a `Step`: identity and versioning, a `step_type` (9 values: `SYSTEM_REFERENCE`, `MODEL_REFERENCE`, `TOOL_REFERENCE`, `HUMAN_APPROVAL_REFERENCE`, `WORKFLOW_REFERENCE`, `DECISION_REFERENCE`, `AUDIT_REFERENCE`, `NOTIFICATION_REFERENCE`, `VALIDATION_REFERENCE`), an ordered/unique `required_capabilities` subset reusing PR #88's 11-value `TOOL_CAPABILITIES` enum, three *nullable* minimal references (`tool_reference`, `model_reference`, `context_reference` — `null` when not applicable to the step's type, otherwise PR #83's generic `SINGLE_REFERENCE` shape), a `depends_on` list of declarative `Dependency` objects, scheduling metadata (`priority`, `parallelizable`, `optional`, `approval_required`), three *nullable* per-step overrides (`timeout_reference`, `retry_reference`, `compensation_reference` — `null` inherits the workflow default), and purely estimated `estimated_cost_minor_units`/`estimated_duration_ms`. No step ever executes anything; these fields are read as declarative metadata only.

## Dependências

`workflow-dependency-contract.js` represents an edge between two steps as one of 4 declarative types: `AFTER_SUCCESS_REFERENCE`, `AFTER_FAILURE_REFERENCE`, `PARALLEL_REFERENCE`, `JOIN_REFERENCE`. `workflow-decision.js` cross-checks that every `depends_on_step_id` refers to a step actually present in the workflow's step set, and that no step declares a dependency on itself — a dangling or self-referential dependency blocks the whole registration rather than silently registering an inconsistent graph. No real synchronization, scheduling, or execution ordering happens in this PR.

## Conditions

`workflow-condition-contract.js` represents `entry_conditions`/`exit_conditions` as an ordered list of declarative `Condition` objects, each one of 5 types: `IF_REFERENCE`, `ELSE_REFERENCE`, `SWITCH_REFERENCE`, `ALWAYS_REFERENCE`, `NEVER_REFERENCE`. No condition expression is ever parsed, evaluated, or interpreted — a condition is a label, not a predicate.

## Retry

`workflow-retry-contract.js` represents a retry policy as one of 4 types (`NONE`, `FIXED_REFERENCE`, `EXPONENTIAL_REFERENCE`, `MANUAL_REFERENCE`) plus a declarative `maximum_attempts` bound (forced to `0` when `retry_type=NONE`). No retry is ever scheduled or executed.

## Timeout

`workflow-timeout-contract.js` represents a timeout policy as one of 5 types: `NONE`, `SHORT_REFERENCE`, `NORMAL_REFERENCE`, `LONG_REFERENCE`, `MANUAL_REFERENCE`. No real timer, deadline, or clock is ever set.

## Compensation

`workflow-compensation-contract.js` represents a compensation policy as one of 4 types: `NONE`, `ROLLBACK_REFERENCE`, `MANUAL_COMPENSATION_REFERENCE`, `HUMAN_COMPENSATION_REFERENCE`. No rollback or compensating action is ever performed.

## Aprovação

`workflow-approval-contract.js` represents an approval policy as one of 5 types: `NONE`, `USER_REFERENCE`, `SUPERVISOR_REFERENCE`, `ADMIN_REFERENCE`, `DUAL_APPROVAL_REFERENCE`. A step's own `approval_required` boolean is independent metadata — no approval is ever requested, granted, or checked in this PR.

## Decisão

`workflow-decision.js#buildWorkflowDecision` aggregates a `Workflow` with its `Step` list into one `WorkflowDecision` record. It validates the workflow and every step independently, verifies `step_references` matches the provided step set exactly, verifies every dependency graph edge resolves to a real, non-self step, and cross-checks that the workflow's `approval_policy_reference`/`timeout_reference`/`retry_reference`/`compensation_reference` — and any non-null per-step override of the latter three — are bound to the same `tenant_id`/`organization_id` as the workflow itself. Any mismatch blocks the whole registration (`TENANT_BLOCKED`/`ORGANIZATION_BLOCKED`) rather than silently registering an inconsistent workflow; any other structural problem degrades to `VALIDATION_FAILED`/`BLOCKED`, mirroring the pattern established in PR #84's `model-selection-decision.js` and PR #88's `tool-decision.js`.

## Registry

`workflow-registry.js` is a private, in-memory, synthetic registry for workflows, steps and decisions, built on the same replay/payload-mismatch/optimistic-concurrency/fingerprint-conflict/organization-rebinding pattern established in PR #83 and hardened in PR #86. Every stored and returned record is defensively cloned and deep-frozen; nothing is persisted.

## Auditoria

`workflow-audit.js` records only the workflow fingerprint, the step fingerprints, the tenant/organization binding, the decision status, and reason codes — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records a payload.

## Invariantes

Every `WorkflowDecision`, regardless of status, forces: `workflow_executed=false`, `step_executed=false`, `tool_called=false`, `model_called=false`, `provider_called=false`, `network_used=false`, `runtime_enabled=false`, `simulation=true`, `production_blocked=true`, `rollout_percentage=0`. Every contract is exact-fields and deny-by-default; an unrecognized enum, a missing field, an extra field, a duplicate id, or any detected operational material degrades the decision rather than defaulting permissively.

## Limitações

There is no workflow engine, no scheduler, no step executor, no tool invoker, no model caller, no provider client, no real timer, no real retry loop, no real rollback, no real approval gate, no queue, no worker, no cron, no executable callback or handler, no `dynamic import`, no `eval`, and no `Function` constructor anywhere in these modules. Conditions are labels, not predicates — this PR does not evaluate whether an `IF_REFERENCE` condition would actually be true; dependency types (`PARALLEL_REFERENCE`, `JOIN_REFERENCE`, etc.) are graph metadata only — this PR does not schedule, order, or synchronize anything against them.

## Next Steps

**A próxima etapa arquitetural é o Agent Orchestrator.**
