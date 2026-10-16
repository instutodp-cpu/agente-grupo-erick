# Hermes A3 scoped external action — pre-execution admission

## Purpose

This contract adds the final **pure pre-execution admission boundary** for the first A3 candidate family: bounded maintainer SCM write in staging.

It composes existing official contracts instead of creating a second authorization stack:

1. `hermes_a3_scoped_external_action_eligibility_v2` validates the exact approval, authorization, single-use authorization, durable target, operator, cost, environment and protected-action boundaries.
2. `hermes_maintainer_github_write_canary_contract_v1` prepares only the bounded GitHub `create_branch` canary request.
3. The admission contract proves both artifacts refer to the exact same repository, operation, branch ref and base SHA.

## Boundary

A successful admission means only that the candidate package is internally coherent and ready for a later, separately authorized A3 execution decision.

A successful admission **does not**:

- authorize execution;
- call GitHub or any provider;
- perform network I/O;
- create or update a branch/ref;
- consume the single-use authorization;
- enable production;
- grant merge authority;
- promote Hermes from A2 to A3;
- grant any A4 action.

The result therefore always preserves:

- `execution_authorized=false`
- `execution_started=false`
- `executed=false`
- `provider_invoked=false`
- `external_network_called=false`
- `network_call_performed=false`
- `write_performed=false`
- `production_allowed=false`
- `a3_promoted=false`
- `a4_authority_granted=false`

## Exact first candidate scope

- environment: `staging`
- provider: `GITHUB`
- capability family: official maintainer SCM write single-use chain
- operation: `create_branch`
- repository: `instutodp-cpu/agente-grupo-erick`
- branch namespace: `refs/heads/hermes/canary/*`
- base SHA: exact 40-character SHA bound through the durable target and canary request
- merge: forbidden
- production: forbidden

Unknown fields, target drift, authorization expiry/revocation/consumption, protected A4 actions, mismatched ref/SHA/repository/operation, or invalid upstream contracts fail closed.

## Readiness interpretation

This increment is **pre-execution candidate evidence only**. It may become `implemented=true` and `tested=true` after exact-head CI succeeds, but it is not real A3 E2E evidence and must not set `proven_e2e=true` or `operational=true`.

The authoritative autonomy state remains `A2_authorized_bounded`; A3 and A4 remain protected until a separate human-authorized execution and later explicit graduation decision.
