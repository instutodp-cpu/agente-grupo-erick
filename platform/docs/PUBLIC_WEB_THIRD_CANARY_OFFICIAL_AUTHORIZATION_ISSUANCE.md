# Third canary official execution authorization issuance

This layer follows the runtime-authorization bindings contract and is the first third-canary layer allowed to issue the existing official runtime execution Authorization.

Issuance requires the exact confirmation `EXECUTAR CANARY PUBLIC WEB` with a fresh confirmation timestamp no older than 120 seconds. The resulting official Authorization is bound to the prepared Trial/runtime evidence and expires no later than 120 seconds after issuance.

Issuance is deliberately separate from authority consumption and execution. This layer does **not** consume the official Authorization, Grant, preparatory Authorization or Reservation; does not reserve/start execution; and does not invoke provider, transport, DNS or external network.

Success is `THIRD_CANARY_OFFICIAL_EXECUTION_AUTHORIZATION_ISSUED_NOT_CONSUMED_NOT_EXECUTED`. The next isolated layer must address atomic single-use resource consumption/reservation and registry lifetime semantics before any external request can be permitted.
