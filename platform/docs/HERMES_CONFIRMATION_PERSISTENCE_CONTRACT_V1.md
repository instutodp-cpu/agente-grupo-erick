# Hermes Confirmation Persistence Contract V1

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
- `update(record)` replaces an existing record or returns `null`;
- `list()` returns records for expiration pruning;
- `reset()` clears only the owned persistence instance.

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
event loop are serialized by the synchronous adapter, but this contract does
not claim cross-process durability or compare-and-set semantics. A future
PostgreSQL adapter must define atomic create/update and transition conflict
behavior before replacing memory in a productive runtime.

No tenant, workspace, or company dimension is present in the current
confirmation contract. A future multi-tenant durable implementation must
resolve that isolation boundary before activation; this PR does not invent a
new identity field.

## Non-goals

This contract adds no PostgreSQL client, SQL, migration, environment
configuration, secret, network access, HTTP change, D2 reuse, or production
durable activation.
