# Third Public Web Canary — single-use Grant contract

This layer introduces the missing Grant lifecycle contract without wiring it to
the provider, transport, DNS resolver, HTTPS client or canary runner.

The Grant is staging-only, bound to the exact approved target
`https://example.com/` using `GET` on port `443`, limited to one request and
rollout `1`, short-lived (maximum 120 seconds), revocable and replay-safe.

Issuance explicitly rejects human execution authorization and execute/start/
consume actions. Consumption exists only as a contract primitive and requires a
separate explicit-human-authorization signal plus exact scope matching. Even a
successful contract consumption does not execute a canary or invoke any network.

No runtime wiring is added by this layer. Production remains blocked.
