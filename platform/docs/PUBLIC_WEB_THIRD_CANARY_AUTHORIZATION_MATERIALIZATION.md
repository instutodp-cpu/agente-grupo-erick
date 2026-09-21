# Third Public Web Canary — Authorization materialization

This layer materializes the fresh Authorization identity only after the third-canary
Grant materialization has succeeded.

The resulting Authorization is deliberately **not execution authority**. It remains
single-use, unused, bound to the exact trial and Grant, and records
`execution_authorized=false`.

This layer does not consume the Grant, does not materialize the Reservation, does not
reserve or start a trial, and has no runner/provider/transport/DNS/HTTPS/network wiring.

The exact staging scope remains `https://example.com/`, `GET`, port `443`,
`maximum_requests=1` and `rollout_percentage=1`. Production remains blocked.

A successful call stops at `SEPARATE_RESERVATION_MATERIALIZATION_LAYER`.
A later explicit human execution authorization remains a separate gate.
