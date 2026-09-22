# Third canary runtime authorization bindings

This offline layer follows the human authorization gate and prepares the complete evidence binding required by the existing official runtime execution-authorization contract.

It requires the accepted human authorization intent to remain fresh (maximum age 120 seconds), preserves the exact Trial / preparatory Authorization / Grant / Reservation identities, and binds the canary session, plan, preflight evidence, dry-run evidence, target-path hash, operation and contract/version evidence.

This layer deliberately does **not** call `issueAuthorization`. It does not persist or consume the official execution Authorization, Grant, preparatory Authorization or Reservation; does not reserve/start execution; and does not invoke provider, transport, DNS or external network.

Success is `THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_READY_NOT_ISSUED_NOT_EXECUTED`. The next isolated gate may issue a fresh official runtime Authorization from these bindings while execution remains separate.
