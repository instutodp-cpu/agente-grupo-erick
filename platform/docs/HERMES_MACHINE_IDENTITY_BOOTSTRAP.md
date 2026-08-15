# Hermes Machine Identity Bootstrap

This boundary defines the first trusted machine-to-machine identity step for
Hermes. It is configuration-injected and is not connected to the HTTP routes
or process runtime yet.

## Source of truth

The registry receives server-side records containing `key_id`, a SHA-256 hex
digest in `key_digest`, `principal_id`, `tenant_id` and `active`. The canonical
corporate tenant identifier is `grupo_erick`, as defined by the tenant and
workspace contracts.

Plain credentials are never accepted by the registry, stored in source,
returned in an identity, or included in errors. The registry rejects duplicate
key identifiers and duplicate digests, and requires an explicit tenant mapping.

## Resolution

The resolver accepts exactly one credential form: `Authorization: Bearer
<credential>`. It hashes the presented value with SHA-256, performs a
constant-time digest comparison, and returns only:

- machine principal type and ID;
- server-side tenant ID;
- authentication source;
- non-secret key ID.

Request body, query, path and arbitrary tenant headers are not authority.

## Scope

This checkpoint does not enforce authentication on `/message`, `/confirm` or
`/confirm/:id`; it does not read environment variables, load secrets, connect
to PostgreSQL, modify ConfirmationPersistence, or add a route rollout. Future
wiring must inject the registry from a server-side configuration boundary and
must fail closed when the credential or mapping is invalid.

Multiple active keys per principal/tenant are supported for rotation. Setting
`active: false` revokes a configured key without introducing a database.
