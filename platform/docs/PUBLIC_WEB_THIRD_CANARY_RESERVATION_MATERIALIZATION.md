# Third Public Web Canary — Reservation materialization

This layer materializes only the fresh Reservation identity after the third-canary
Authorization identity has been materialized.

The Reservation is not an execution reservation. It remains single-use and unused,
is bound to the exact trial, Authorization and Grant, and records
`execution_reserved=false`.

This layer does not consume the Grant or Authorization, does not call
`reserveOperationalTrial`, does not start execution, and has no
runner/provider/transport/DNS/HTTPS/network wiring.

The exact scope remains staging, `https://example.com/`, `GET`, port `443`,
`maximum_requests=1` and `rollout_percentage=1`. Production remains blocked.

A successful call stops at
`EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_EXECUTION_WIRING`.

Materialization of this Reservation is not authorization to execute the canary.
