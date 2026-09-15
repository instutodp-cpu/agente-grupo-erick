# PR-B0 Configuration Runtime Boundary Contract

Status: normative documentation-only companion to
`PR_B_CONFIGURATION_CONTRACT.md`. This document resolves configuration-boundary
ambiguities before any functional PR-B implementation. It does not implement,
wire, enable or authorize runtime behavior.

## 1. Purpose and authority

`PR-B0_CONFIGURATION_RUNTIME_BOUNDARY` defines the runtime-neutral contract for
configuration parsing, normalization, validation and synthetic preflight. It
specializes the existing PR-B contract and the provider configuration boundary;
it does not supersede them and does not alter the existing Operational Trial.

The contract applies only to non-production configuration and synthetic
preflight/dry-run contexts. Configuration readiness is not provider readiness,
transport authorization, production authorization or authorization for PR-C.

The prerequisite remains PR-A / PR #195 and all invariants recorded in
`PR_B_CONFIGURATION_CONTRACT.md`.

## 2. Canonical controls and types

The following control names and types are normative:

| Control | Type | Semantic default | Safe meaning |
| --- | --- | --- | --- |
| `HERMES_PUBLIC_WEB_READ_ONLY_ENABLED` | strict boolean | `false` | candidate disabled |
| `HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH` | strict boolean | `true` | kill switch active; execution blocked |

Boolean values are strict booleans. String coercion, numeric coercion, null,
arrays, objects and unknown values are invalid. The configuration contract
also retains these required safety fields:

- `feature_flag_default: false`;
- `kill_switch_required: true`;
- `simulated: true` for synthetic contexts;
- `executed: false` for PR-B0 preflight and synthetic dry-run results;
- `real_provider_called: false`;
- `can_trigger_real_execution: false`.

`kill_switch_required: true` means that the kill-switch control and its guard
are mandatory. `kill_switch_default: true` is the normative default even where
the existing generic contract does not currently materialize that field.

## 3. Authorized sources and precedence

Only these sources are recognized by this boundary:

1. immutable safety invariants from this contract and the existing contracts;
2. an explicitly supplied, allowlisted, non-production configuration document;
3. an explicitly supplied synthetic test context, only for deterministic tests;
4. the semantic safety defaults defined in Section 2.

Safety invariants and fail-closed outcomes have precedence over every supplied
value. A synthetic test context is not an operational configuration source and
cannot authorize real execution.

Defaults are applied only as safe state representation. They never convert a
missing required configuration into readiness or execution authorization.
An absent or invalid explicit value must not silently fall back to a
permissive value.

The following are not authorized sources for PR-B0 or future PR-B
configuration-only behavior:

- production configuration or production routing;
- provider SDKs, provider APIs or network responses;
- real environment credentials or secret stores;
- runtime registration, scheduler, worker or queue execution;
- database or durable operational state.

## 4. Fail-closed rules

The result is blocked and non-authorizing when any of the following occurs:

- the complete configuration is absent;
- a required field or required control is absent;
- a value is malformed, has the wrong type or is outside its allowlist;
- an unknown field, unknown control or unknown source is supplied;
- configuration values are inconsistent with the safety invariants;
- the provider, adapter, lifecycle, tenant/workspace identity or target does
  not match the expected contract;
- a provider configuration or secret reference is missing, inactive, invalid,
  or incompatible;
- the kill switch cannot be proven active by default or explicitly disabled
  only inside an authorized synthetic test context.

No failure path may enable transport, downgrade a safety control, resolve a
real secret, or produce an externally observable side effect.

## 5. Feature flag, kill switch, registry and readiness

`feature_flag_default: false` describes the contract default for
`HERMES_PUBLIC_WEB_READ_ONLY_ENABLED`; it does not itself authorize the flag,
the canary or transport. A true value is meaningful only when explicitly
provided in an authorized synthetic/non-production test context and all other
contract checks pass.

`kill_switch_required: true` requires the existing kill-switch mechanism to be
present and evaluated. Its default state is active:
`HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH=true`. Only an explicit synthetic test
context may represent the switch as inactive for a deterministic test, and
that context must remain simulated and non-authorizing.

The provider configuration registry may store validated, non-sensitive
descriptors in its existing private in-memory form. The readiness evaluator
may consume those descriptors and synthetic secret references. Neither
registry nor readiness may turn a descriptor into a provider credential,
network client, runtime registration or execution permission.

## 6. Provider and secret absence

Missing or invalid provider configuration is not “not configured yet” in a way
that permits progress; it is a blocked readiness result. Missing or invalid
secret references are likewise blocked.

Only the already supported synthetic `local_test_double_reference` form may be
recognized for deterministic tests. It must remain an opaque descriptor. PR-B0
must never resolve, create, persist, print, snapshot, expose or transmit a
real secret or a real secret handle.

## 7. Synthetic preflight/dry-run boundary

For this contract, `simulated=true` means that all inputs, dependencies,
targets and effects are synthetic or injected fakes. `executed=false` means
that no real or externally observable execution attempt occurred. Invoking a
fake function or producing an in-memory result is not execution for PR-B0.

The canonical PR-B0 result is therefore:

```text
simulated=true
executed=false
real_provider_called=false
can_trigger_real_execution=false
```

Preflight and synthetic dry-run must not open sockets, resolve real DNS, make
HTTP requests, invoke a provider, invoke `/message` or `/confirm`, resolve a
real secret, write to a database, persist operational state or cause any
external side effect.

The synthetic path must not obtain its safety from merely defaulting an
injected dependency to a fake. Its boundary must exclude real runner and
transport call paths by contract.

### Known Operational Trial incompatibility

`PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL.md` and its existing characterization
test historically describe the Operational Trial dry-run with
`executed:true`, `real_provider_called:false` and `simulated:true`, reflecting
one fake runner call. That behavior is retained as a known incompatibility in
this PR-B0. This document does not modify the Operational Trial, its code or
its tests.

The normative `executed=false` meaning above applies to PR-B0 preflight and
synthetic dry-run only. Any future alignment of the Operational Trial requires
a separately reviewed change; this known incompatibility blocks treating the
current implementation as proof that functional PR-B is safe.

## 8. Permitted future consumers

After separate authorization, the contract may be consumed by only:

- configuration contract/type definitions;
- parsing and normalization;
- configuration validation;
- the existing in-memory configuration registry;
- readiness evaluation;
- deterministic preflight;
- a synthetic dry-run harness isolated from real execution;
- unit, contract, characterization, negative/fail-closed and preflight tests;
- directly associated documentation and synthetic fixtures.

The following are not consumers of the PR-B0 boundary:

- `public-web-canary-runner.js`;
- the real transport candidate;
- real DNS or HTTPS clients;
- `/message` or `/confirm`;
- the application entrypoint and production routing;
- endpoints, schedulers, workers, queues or automated execution;
- provider SDKs or real secret resolvers;
- persistence, database writes, migrations or ledger changes.

## 9. Explicit authorization boundary

The following remain unauthorized:

```text
PR_B_REMAINS_UNAUTHORIZED=true
PR_C_REMAINS_UNAUTHORIZED=true
REAL_EXECUTION_REMAINS_UNAUTHORIZED=true
```

No default, registry state, readiness result, preflight result, synthetic
fixture, approval or merge of PR-B0 grants authorization for PR-B, PR-C, real
transport, production routing, canary activation, provider calls or secret
resolution.

`PR-C_REAL_TRANSPORT` may begin only after a separate PR-B implementation is
reviewed, CI-green and merged, followed by explicit human authorization to
start PR-C. No approval or merge of PR-B0 or PR-B implies that authorization.

## 10. PR-B0 acceptance criteria

PR-B0 is acceptable only when:

- the change is documentation-only and limited to this contract;
- the two controls, their strict boolean types and safe defaults are explicit;
- source precedence and safety vetoes are explicit;
- missing, malformed, unknown and inconsistent inputs fail closed;
- `executed=false` is defined for PR-B0 preflight/synthetic dry-run;
- the historical Operational Trial incompatibility is recorded without being
  silently changed;
- provider/secret absence is blocking and no real secret is handled;
- permitted and prohibited consumers are explicitly separated;
- PR-A invariants remain preserved;
- no runtime, runner, transport, provider, secret, endpoint, scheduler,
  worker, queue, production, CI, database, migration or test change is made;
- human review occurs before any functional PR-B work.

## 11. PR-B0 NO-GO criteria

PR-B0 or any follow-up implementation is blocked by:

- unresolved ambiguity between PR-B and PR-C;
- a need to change runtime behavior to establish this contract;
- any reachable or unisolated real transport, provider call, DNS, HTTP,
  socket, secret resolution or external side effect;
- any production change, database write, persistence, migration or ledger
  change;
- any real secret, credential or provider handle;
- any changed file outside the approved B0 document;
- any regression of the PR-A invariants.
