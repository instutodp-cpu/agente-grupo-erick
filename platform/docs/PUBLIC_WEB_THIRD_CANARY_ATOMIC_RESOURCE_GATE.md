# Third canary atomic resource preparation gate

This layer follows official execution-Authorization issuance and prepares the contract for atomic single-use resource mutation. It is intentionally preparation-only.

The gate validates the fresh, unused official Authorization and exact Trial/preparatory-Authorization/Grant/Reservation identities. It produces the required transaction order: validate all resources, begin an atomic boundary, consume the official Authorization, consume the Grant, reserve the Reservation for execution, and commit.

No registry is accessed and no resource is mutated in this layer. Authorization/Grant/Reservation remain unconsumed, execution remains unreserved and unstarted, and provider/transport/DNS/external network are forbidden.

The contract explicitly requires rollback on any mutation failure, a coherent same-runtime registry lifecycle, and durable replay state before external execution. The next isolated layer must implement those transaction semantics before any real request can be allowed.
