# Hermes VPS Execution Authorization Contract V1

This contract is the explicit authorization boundary between the declarative
VPS Provisioning Plan V1 and any future provisioner or executor.

```text
Host Contract -> Bootstrap Contract -> Provisioning Plan
              -> Execution Authorization -> future Executor
```

`PLAN != AUTHORIZATION != EXECUTION`. The contract contains no executor,
provider client, SSH path, shell path, persistence adapter or secret value.
Creating or validating an authorization does not perform an operation.

## Binding and lifecycle

An authorization is bound to the exact Provisioning Plan V1 version and
`plan_hash`, target environment, target reference, scope, issuer and time
window. `binding_hash` covers immutable authorization material; lifecycle
state is validated separately by `authorization_hash`.

The only valid positive state is explicit `AUTHORIZED` with
`execution_authorized: true`. Missing, malformed, unknown, mismatched,
expired, revoked or already-consumed authorizations deny. V1 is staging-only,
single-use, provider/network/shell-disabled and production-disabled.

Consumption and revocation are represented as references and state only. This
contract performs no persistence or atomic consume operation; a future
executor must provide that separately before execution authorization can be
used operationally.

Canonical SHA-256 material uses the repository serializer. No secrets,
credentials or volatile runtime values are included.
