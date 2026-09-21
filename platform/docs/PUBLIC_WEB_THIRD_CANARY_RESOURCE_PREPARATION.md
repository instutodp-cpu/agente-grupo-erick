# Third Public Web Canary — resource preparation

This layer is intentionally offline and non-operational.

It creates deterministic **candidate identities** for the fresh single-use human
authorization, grant and reservation required by the third canary. Candidates are
not runtime resources and do not grant execution authority.

## Safety boundary

The preparation function:

- is staging-only and production-fail-closed;
- is bound to the approved target `https://example.com/`, `GET`, port `443`;
- requires `maximum_requests=1` and `rollout_percentage=1`;
- rejects human execution authorization in this phase;
- rejects execute/start/consume signals;
- never invokes provider, transport, DNS, sockets or HTTPS;
- does not call `startOperationalTrial`, `consumeAuthorization` or
  `runCanaryRequest`;
- marks grant/reservation candidates as `candidate_not_materialized`;
- requires a separate explicit human gate before any materialization or execution.

This PR must not be interpreted as authorization to execute the third canary.
