# Hermes VPS Runtime Provisioning Source V1

This boundary converts one explicit, non-secret runtime input into the
canonical Hermes VPS bootstrap contract and provisioning plan.

## Input authority

`createHermesVpsRuntimeProvisioning({ input })` accepts exactly:

- `provenance.repository`;
- `provenance.branch`;
- `provenance.commit_sha`;
- `bootstrap_overrides`, interpreted by the existing bootstrap contract.

There is no environment fallback, default provisioning source, JSON fallback,
database lookup, network lookup, or competing source. Missing or unknown input
fails closed.

## Contract reuse

The boundary delegates construction to
`buildHermesVpsBootstrapContract` and
`buildHermesVpsProvisioningPlan`. It does not duplicate their fields,
validation, hashing, phase definitions, or revision semantics.

The resulting plan remains declarative and safe: `PLAN_ONLY`, provider-neutral,
staging-only, with no execution authorization and no production effect.

## Separation of concerns

This module does not read environment variables, select `memory` or
`postgres`, create a persistence composition, open a connection, or inject a
consumer. Backend selection remains the D2 factory's responsibility. External
configuration acquisition and later process-root wiring are separate
checkpoints.

Secret material, connection strings, database settings, tenant/workspace
fields, and unknown input fields are not accepted by this source boundary.
