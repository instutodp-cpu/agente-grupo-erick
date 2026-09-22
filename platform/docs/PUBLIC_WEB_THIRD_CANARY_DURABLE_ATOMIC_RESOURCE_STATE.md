# Third canary durable atomic resource state

This readiness layer follows the single-use transaction contract and fail-closes unless the runtime supplies a durable transactional store contract.

The store must be durable, shared across runtime instances, production-backed, and advertise atomic compare-and-set, transactional rollback, durable replay protection, and unique resource constraints. Process-local or in-memory state is insufficient.

This layer intentionally does not begin a transaction, write state, consume Authorization/Grant/Reservation, reserve execution, start execution, or access provider/transport/external network. Production execution remains blocked.

The next layer may implement the actual atomic resource transaction and execution reservation only after these durable capabilities are backed by a real store.
