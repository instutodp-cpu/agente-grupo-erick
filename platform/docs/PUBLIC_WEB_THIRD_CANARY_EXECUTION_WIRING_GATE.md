# Third Public Web Canary — execution wiring gate

This layer validates the materialized third-canary Reservation and prepares only an
offline wiring descriptor for the eventual real execution path.

It does **not** issue or consume the official execution Authorization, consume the
Grant or Reservation, call `reserveOperationalTrial`, start execution, invoke the
runner/provider/transport, resolve DNS, open HTTPS, or access the external network.

The exact allowed scope remains staging only, `https://example.com/`, `GET`,
port `443`, `maximum_requests=1`, and `rollout_percentage=1`. Production is
blocked.

A successful result is
`THIRD_CANARY_EXECUTION_WIRING_READY_NOT_AUTHORIZED` and stops at
`EXPLICIT_HUMAN_AUTHORIZATION_FOR_REAL_THIRD_CANARY_EXECUTION`.

The existing official execution-authorization contract remains the authority for
the later execution phase. This gate deliberately does not call it.

Merge approval for this PR is not authorization to execute the canary.
