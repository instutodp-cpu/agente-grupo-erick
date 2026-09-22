# Third canary single-use transaction contract

This layer converts the atomic-resource preparation gate into an explicit transaction contract. It is contract-only and performs no mutations.

The required order is fixed: validate all single-use resources, begin one atomic boundary, consume the official execution Authorization, consume the Grant, reserve the Reservation for execution, then commit. Any mutation failure requires rollback. Partial commits and retry after a partial failure are forbidden.

The contract requires durable replay state and coherent registry lifecycle before external execution. It does not accept registry or persistence clients, does not begin/commit/rollback a real transaction, does not consume resources, does not reserve/start execution, and forbids provider/transport/DNS/external network.

The next isolated layer must implement durable atomic single-use resource state satisfying this contract before any real canary request can be permitted.
