# Hermes Confirmation Persistence Contract V2

`confirmation-store.js` is the productive confirmation consumer used by the
Hermes API for `POST /message`, `POST /confirm`, and `GET /confirm/:id`. This
contract is separate from the Hermes VPS authorization lifecycle persistence
contract and must not reuse its `read`, `insert`, `compareAndConsume`, or
`revoke` semantics.

## Boundary

`ConfirmationPersistence` is a small synchronous persistence port with these
operations:

- `create(record)` stores and returns a confirmation record;
- `get(confirmation_id)` returns a record or `null`;
- `compareAndTransition({ confirmation_id, expected_status, next_status })`
  atomically applies a conditional status change and returns an outcome;
- `list()` returns records for expiration pruning;
- `reset()` clears only the owned persistence instance.

The transition outcome is `transitioned`, `unchanged`, `not_found`, or
`state_mismatch`. The persistence layer does not decide which status changes
are valid; it only enforces the expected-current-state comparison and returns
the resulting record. A future PostgreSQL adapter must implement this as a
conditional update equivalent to `UPDATE ... WHERE confirmation_id = ? AND
status = expected_status`, inside the database transaction boundary.

The record fields are `confirmation_id`, `trace_id`, `domain`, `intent`,
`status`, and `expires_at`. The persistence port stores values; expiration,
valid status transitions, and response semantics remain in the confirmation
store/domain layer.

## Current implementation

`createMemoryConfirmationPersistence()` is the current implementation. It is
injectable and clones records at the boundary, preventing callers from
mutating stored state by reference. Existing module-level exports remain as a
backward-compatible memory composition for the current API runtime and tests.

The current behavior is synchronous and process-local. Calls in one Node.js
event loop are serialized by the synchronous adapter. `compareAndTransition`
is the explicit atomic transition contract; a future PostgreSQL adapter must
provide the same result semantics across processes.

No tenant, workspace, or company dimension is present in the current
confirmation contract. A future multi-tenant durable implementation must
resolve that isolation boundary before activation; this PR does not invent a
new identity field.

## Non-goals

This contract adds no PostgreSQL client, SQL, migration, environment
configuration, secret, network access, HTTP change, D2 reuse, or production
durable activation.
