# Third canary atomic resource transaction and execution reservation

This layer converts the durable-state readiness contract into an exact atomic transaction plan. It remains preparation-only.

The future commit must prevalidate identities, unused state, expiries, and durable replay state; then atomically mark the official Authorization consumed, mark the Grant consumed, mark the Reservation execution-reserved, and write the durable replay commit. All mutations must succeed before commit; any mutation failure requires rollback. Replay fails closed.

This PR does not accept transaction clients or mutable registries and performs no begin/write/commit, resource consumption, execution reservation, execution start, provider/transport call, DNS, or external network access. Production remains blocked.

The next gate is the isolated atomic transaction commit implementation. Even after that commit, execution must remain separate and explicitly authorized.
