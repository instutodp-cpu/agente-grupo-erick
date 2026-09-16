# Public Web Canary Operational Trial Readiness

## Purpose and scope

This document defines the readiness-only checkpoint for the Public Web Canary
Operational Trial. It prepares a deterministic, auditable decision about
whether a synthetic preflight may be entered. It does not execute a canary,
authorize real execution, activate PR-C, or change production behavior.

The normative predecessors are:

- `PR_B_CONFIGURATION_CONTRACT.md`;
- `PR_B0_CONFIGURATION_RUNTIME_BOUNDARY_CONTRACT.md`;
- `PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL.md`;
- `PUBLIC_WEB_CANARY_QUEUED_HANDOFF_RUNBOOK.md`.

PR-B configuration readiness is not provider readiness, canary activation,
production authorization, or authorization for `PR-C_REAL_TRANSPORT`.

## Existing implementation boundary

The readiness evaluator is the existing pure core module:

`platform/services/api/src/core/public-web-canary-preflight-readiness-boundary.js`

Its existing contract test is:

`platform/services/api/test/public-web-canary-preflight-readiness-boundary.test.js`

This checkpoint does not create a parallel readiness evaluator, wire the
Operational Trial, or modify the historical Operational Trial implementation.

## Readiness result

The only positive outcome is:

```text
status=PUBLIC_WEB_CANARY_PREFLIGHT_READY
decision=ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT
next_state=WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN
```

This means only that the supplied preparation evidence and trial plan may
enter a non-side-effect synthetic preflight. It never means ready for real
execution.

Any missing, invalid, stale, mismatched or authority-escalated input returns a
blocked or validation-failed result with `fail_closed` and explicit reason
codes. The evaluator must not mutate its inputs, and equivalent inputs must
produce equivalent readiness output and fingerprints.

## Required safety boundary

Every readiness result, including a positive one, preserves:

```text
dry_run_authorized=false
operator_confirmation_authorized=false
trial_execution_authorized=false
provider_called=false
external_network_used=false
secret_resolved=false
runtime_execution=false
worker_execution=false
queue_mutation=false
scheduler_mutation=false
dispatch_execution=false
operational_persistence=false
real_execution_authorized=false
production_effect=ZERO
```

The evaluator may inspect explicit synthetic evidence and sanitized
descriptors, but it must never:

- call a provider or network client;
- resolve a real secret;
- invoke the operational runner;
- invoke `/message` or `/confirm`;
- start an endpoint, scheduler, worker or queue execution;
- write to a database, ledger or operational persistence;
- change feature flags, kill switches, routing or production;
- create or apply migrations.

`simulated=true`, `executed=false`, `real_provider_called=false` and
`can_trigger_real_execution=false` remain mandatory for the synthetic path.
The historical Operational Trial characterization that records a fake dry-run
as `executed=true` is a known incompatibility and is not used as evidence for
this readiness checkpoint.

## Required evidence

Readiness must fail closed unless the explicit inputs prove, consistently and
within the expected identity scope:

- eligible execution-preparation evidence;
- a valid, non-production, single-request trial plan;
- matching trial, plan, tenant and binding identities;
- configuration and readiness evidence with no real provider authorization;
- represented synthetic secret references without secret material;
- no network, provider, secret, runtime, worker, queue, scheduler, dispatch,
  persistence or production authority;
- sanitized, deterministic evidence and audit candidates.

Readiness does not materialize missing configuration and no default grants
authorization. Unknown fields, sources, controls, identities or capabilities
are blocking inputs.

## Acceptance and no-go criteria

This checkpoint is acceptable only when the existing readiness contract tests,
the relevant Public Web Canary tests and the offline architecture gates are
green, with no change to the Operational Trial or durable audit invariants.

It is a no-go if any real capability is reachable, any required evidence is
missing or inconsistent, any secret value is present, any database or
operational write is needed, or any step would authorize PR-C or real
execution. A readiness result never replaces human review or explicit future
authorization for a controlled canary.

