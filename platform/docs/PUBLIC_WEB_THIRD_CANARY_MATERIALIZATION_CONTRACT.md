# Third Public Web Canary — materialization contract

This layer validates the exact boundary required before any third-canary resource
materialization. It consumes only candidate metadata and performs no materialization,
authorization consumption, reservation, runner/provider/transport/DNS/HTTPS call.

The contract is staging-only and binds all three fresh single-use candidate identities
(Authorization, Grant and Reservation) to one trial and the exact approved target:
`https://example.com/`, `GET`, port `443`, one request, rollout `1`.

Previous, consumed, reused, cross-trial or colliding resource identities fail closed.
Production is blocked. Human execution authority and materialize/execute/start/consume
actions are forbidden in this layer.

A successful validation ends at
`EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_RESOURCE_MATERIALIZATION`.
It does not authorize or execute the canary.
