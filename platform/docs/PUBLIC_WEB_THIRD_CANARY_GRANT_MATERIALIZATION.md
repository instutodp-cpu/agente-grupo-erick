# Third Public Web Canary — Grant materialization

This layer materializes only the fresh single-use Grant identified by the approved
third-canary materialization contract.

It does not materialize the human Authorization or Reservation, does not consume the
Grant, and does not authorize or start execution. It has no runner, provider,
transport, DNS or HTTPS wiring.

The materializer requires the exact staging scope already validated by the preceding
contract: `https://example.com/`, `GET`, port `443`, one request and rollout `1`.
The Grant remains short-lived (maximum 120 seconds), replay-safe and bound to the
Authorization candidate identity.

A successful call ends at `SEPARATE_AUTHORIZATION_MATERIALIZATION_LAYER`.
Production and external network execution remain blocked.
