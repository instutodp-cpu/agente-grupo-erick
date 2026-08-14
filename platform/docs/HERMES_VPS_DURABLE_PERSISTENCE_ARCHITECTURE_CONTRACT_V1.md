# Hermes VPS Durable Persistence Architecture Contract V1

Status: approved architecture contract; logical design only.

This document defines the persistence architecture that future Hermes/VPS
durable-storage work must implement. It does not create a database client,
schema migration, production adapter, runtime wiring, credential, or
production write.

## 1. Architecture Decision

PostgreSQL, including the existing Supabase-hosted PostgreSQL deployment,
is the approved target durable persistence plane for Hermes state that must
survive process restart and be shared by multiple Hermes instances.

The planned access model is a direct PostgreSQL connection from trusted
server-side Hermes runtime code. The connection is server-side only, uses
TLS, and is never exposed to a client bundle. A production Hermes process
must fail closed when the required durable configuration or connection is
unavailable. It must never silently select a Map-backed implementation.

This is an architectural target, not an assertion that the Hermes runtime
already has a PostgreSQL adapter. The existing repository PostgreSQL code is
legacy/analytics infrastructure and does not by itself establish Hermes
durable persistence or authorize production access.

## 2. Authority Boundary

The two persistence planes have separate ownership. The same Hermes state
must not have two authoritative owners.

### Base44

`BASE44_AUTHORITATIVE_FOR`: no Hermes durable authorization, lifecycle,
attempt, admission, coordination, audit, receipt, lease, or fencing state.
Base44 references elsewhere in the repository do not create an active
Hermes persistence dependency.

### PostgreSQL

`POSTGRES_AUTHORITATIVE_FOR`: Hermes durable state introduced by the
authorization lifecycle, trusted admission, and shared coordination
contracts once their production adapters are implemented. This includes the
canonical lifecycle record and, in later layers, the coordinated snapshot,
audit references, receipt references, and distributed ownership metadata.

`STATE_NEVER_DUPLICATED_ACROSS_BOTH`: authoritative Hermes lifecycle,
authorization-consumption, attempt, admission, coordination, audit, receipt,
lease, and fencing state.

`DUAL_WRITE_REQUIRED = NO`.

No implementation may write the same authoritative Hermes state to Base44
and PostgreSQL. A future read model or projection may exist only when it is
explicitly labeled non-authoritative, has a declared source, and cannot be
used as an alternative write owner. Eventual consistency is not permitted
for an authoritative decision or admission read.

## 3. Relationship to Existing Hermes Contracts

PR #133 defines the existing `HermesVpsAuthorizationLifecyclePersistence`
interface with the operations `read`, `insert`, `compareAndConsume`, and
`revoke`. PR-B.1 versions the compatibility-preserving interface as
`hermes-vps-authorization-lifecycle-persistence-v2`: operations may return a
plain result or a Promise of the same result, and mutating operations receive
the deterministic lifecycle receipt they must persist atomically. Its
deterministic Map-backed store remains `REFERENCE_TEST_ONLY` and is retained
for semantic tests and restart simulations.

PR-A does not implement the PostgreSQL adapter. PR-B.1 is the minimal
compatibility hardening required before PR-C: it preserves lifecycle meanings
while making the persistence boundary usable by asynchronous database I/O
and durable receipt storage. PR-C is responsible for the production adapter.
The PR #136 shared durable coordination contract remains the authority for
the later atomic coordination primitive; PR-A does not implement or replace
it.

The future adapter must preserve the existing meanings of lifecycle state,
fingerprints, expected versions, receipts, replay outcomes, and fail-closed
errors. Persistence is not execution authorization.

## 4. Identity and Isolation Model

The current Hermes contracts define the following identity material.

| Dimension | Classification | Contract basis and rule |
| --- | --- | --- |
| `authorization_id` | `REQUIRED_KEY` | Canonical authorization identity in #133 and #136. It is immutable and must be unique within the Hermes durable plane. |
| Authorization hash | `REQUIRED_KEY` material | Binds the stored authorization payload to its canonical identity and detects reuse with different content. |
| `scope_key` / execution scope | `REQUIRED_KEY` material | Participates in the #136 active-attempt coordination key; it is not caller-rebindable. |
| `plan_version` and `plan_hash` | `REQUIRED_KEY` material | Bind lifecycle and coordination to the exact provisioning plan. |
| Lifecycle reference and fingerprint | `LOGICAL_REFERENCE` | Binds an attempt and admission to the consumed lifecycle transition. |
| Attempt ID and owner reference | `LOGICAL_REFERENCE` | Binds coordination to the canonical attempt and its owner; ownership cannot be transferred by retry. |
| Admission ID and handoff fingerprint | `LOGICAL_REFERENCE` | Binds the trusted durable admission result to the same authorization, lifecycle, attempt, and owner. |
| `tenant_id` | `NOT_PRESENT_IN_CONTRACT` | No Hermes authorization/lifecycle/coordination contract currently defines it. It must not be invented as a storage key. |
| `organization_id` | `NOT_PRESENT_IN_CONTRACT` | Not present in the relevant Hermes #133/#136 identity model. |
| `workspace_id` / `espaco_id` | `NOT_PRESENT_IN_CONTRACT` | Not present in the relevant Hermes #133/#136 identity model. |
| `company_id` | `NOT_PRESENT_IN_CONTRACT` | Not present in the relevant Hermes #133/#136 identity model. |
| `mission_id` | `NOT_PRESENT_IN_CONTRACT` | Not present in the relevant Hermes #133/#136 identity model. |
| `run_id` | `NOT_PRESENT_IN_CONTRACT` | Not present in the relevant Hermes #133/#136 identity model. |

The minimum current isolation boundary is the exact canonical identity
material already validated by the contracts: authorization ID, authorization
hash, scope key, plan version/hash, lifecycle reference, attempt/owner
reference, admission identity, and their deterministic fingerprints. A
storage lookup or replay must reject any mismatch rather than broadening the
lookup.

The absence of tenant, organization, workspace, company, mission, and run
identities is deliberate and must remain visible. No multi-tenant or
cross-workspace production scenario may be enabled until the authoritative
Hermes contracts add those dimensions, define their binding, and define
their database isolation policy. PostgreSQL row-level security cannot repair
an identity dimension that the application contract does not carry.

## 5. Logical PostgreSQL Schema Model

`LOGICAL_SCHEMA_ONLY = YES`

`SQL_MIGRATION_INCLUDED = NO`

The following is a logical model for PR-B and PR-C. It is not executable SQL
and does not authorize a migration.

### Candidate table: `hermes_authorization_lifecycle`

| Logical field | Contract origin | Mutability and constraint |
| --- | --- | --- |
| `authorization_id` | #133 authorization identity | Immutable primary key; non-empty and unique. |
| `authorization_payload` | #133 authorization contract | Immutable canonical representation; must validate before write. |
| `authorization_hash` | #133 authorization binding | Immutable; must match the payload and the requested identity. |
| `provisioning_plan_version` | #133/#136 plan binding | Immutable reference; required with the plan hash. |
| `provisioning_plan_hash` | #133/#136 plan binding | Immutable canonical digest; mismatch is a conflict. |
| `execution_scope` | #133 authorization scope | Immutable canonical scope representation; no execution flags may be widened. |
| `state` | #133 lifecycle registry | Mutable only through the contract transition; allowed values are `REGISTERED`, `CONSUMED`, and `REVOKED`. |
| `sequence` | #133 lifecycle registry | Mutable monotonic version; compare-and-set on every transition. |
| `consumption_reference` | #133 lifecycle transition | Null until consumed, then immutable; must reference the same authorization. |
| `revocation_reference` | #133 lifecycle transition | Null unless revoked, then immutable; must reference the same authorization. |
| `fingerprint` | #133 lifecycle fingerprint | Recomputed canonical state binding; used for conditional writes. |
| `receipt_reference` | #133 lifecycle receipt | Durable reference to the lifecycle outcome; must retain the canonical identity. |
| `receipt_hash` | #133 receipt material | Immutable deterministic digest of the receipt facts. |
| `created_at` | Persistence metadata | Immutable server/database timestamp; not an input identity. |
| `updated_at` | Persistence metadata | Server/database timestamp updated only with a committed transition. |

The #136 coordinated snapshot is a later logical extension, not a PR-A
table implementation. Its canonical fields are the already-defined
`coordination_key`, `replay_key`, authorization/lifecycle/attempt/admission
references, expected versions, correlation ID, audit reference, receipt
reference, coordination fingerprint, and the mandatory
`execution_allowed = false` / `production_effect = ZERO` values. PR-B/C/D
must decide whether this is an extension or a separate table without
creating duplicate authoritative records.

Logical references are preferred over copied mutable owners. Any duplicated
payload must be a validated immutable snapshot with an explicit source, not
a second owner.

## 6. Transaction and Concurrency Contract

The future PostgreSQL adapter must provide the following guarantees using
one database transaction for each lifecycle transition:

- `TRANSACTION_BOUNDARY`: validate the canonical input, read the current
  row, conditionally write the complete new lifecycle state, and persist its
  receipt outcome in one transaction. A failed transaction exposes no new
  authoritative state.
- `INSERT_CONFLICT_BEHAVIOR`: a duplicate `authorization_id` is a conflict;
  an exact equivalent retry may return the existing deterministic result,
  but a different payload is rejected.
- `UPDATE_CONFLICT_BEHAVIOR`: `compareAndConsume` and `revoke` require the
  expected current fingerprint/version. A zero-row conditional update is a
  deterministic conflict or stale result, never an overwrite.
- `IDEMPOTENCY_KEY`: use the canonical authorization identity and lifecycle
  fingerprint for #133 operations. The #136 coordination key and replay key
  remain authoritative for the later coordination adapter.
- `UNIQUE_CONSTRAINT_STRATEGY`: enforce the canonical immutable identity and
  any later active-attempt/coordination uniqueness in PostgreSQL, not only in
  application memory.
- `COMPARE_AND_SET_STRATEGY`: use a version or fingerprint predicate in the
  conditional update and require exactly one affected row for success.
- `ROW_LOCKING_STRATEGY`: row locks may serialize a transition when needed;
  they do not replace unique constraints or the compare-and-set predicate.
- `SERIALIZATION_REQUIREMENTS`: concurrent contenders have one durable
  winner. Serialization failures, deadlocks, unavailable storage, and
  unknown commit outcomes are returned as deterministic fail-closed results
  suitable for explicit retry/reconciliation.

These requirements do not claim distributed transactionality with a future
provider or executor. External-operation idempotency and completion recovery
remain outside this architecture contract.

## 7. Future PR #137 Coordination Model

The following is a design reservation only. No lease or fencing logic is
implemented by PR-A.

| Field | Future contract requirement |
| --- | --- |
| `LEASE_IDENTITY` | Canonical coordination/ownership identity bound to the existing authorization, scope, plan, attempt, and owner references. |
| `LEASE_OWNER` | Existing canonical attempt owner; never a caller-supplied replacement. |
| `LEASE_EXPIRATION` | Server/database-controlled expiration, not an untrusted client timestamp. |
| `RENEWAL_RULE` | Conditional renewal by the current owner and current fencing token before expiration. |
| `FENCING_TOKEN` | Monotonic durable token attached to ownership transitions. |
| `FENCING_INCREMENT` | Atomic increment in the same transaction as acquisition or valid renewal. |
| `STALE_OWNER_REJECTION` | Any stale owner or token is rejected, including after restart or delayed delivery. |
| `ATOMIC_ACQUIRE` | One conditional transaction that establishes one active owner and token. |
| `ATOMIC_RENEW` | One conditional transaction that changes only the current owner/token record. |
| `ATOMIC_RELEASE` | One conditional transaction that releases only the current owner/token record. |

`PR137_IMPLEMENTED = NO`.

`EXTERNAL_COORDINATION_SERVICE_REQUIRED = NO` under the approved design:
PostgreSQL transactions, unique constraints, conditional updates, row
locking, and monotonic fencing values are sufficient primitives. This is a
future implementation requirement, not evidence that PR-A has implemented
or configured them.

## 8. Server Access and Security Model

- `SERVER_ACCESS_MODEL`: direct PostgreSQL connection from trusted
  server-side Hermes code.
- `ENV_VAR_NAME_CANDIDATE`: `HERMES_DURABLE_DATABASE_URL` (documentary
  candidate only; no value is present or created by PR-A).
- `SERVER_SIDE_ONLY = YES`.
- `CLIENT_BUNDLE_EXPOSURE = FORBIDDEN`.
- `SERVICE_ROLE_REQUIRED`: a dedicated least-privilege server-side database
  role or equivalent service credential, to be approved during adapter
  implementation; no existing secret is copied by this contract.
- `DIRECT_POSTGRES_CONNECTION = REQUIRED_FOR_TRANSACTIONAL_COORDINATION`.
- `SUPABASE_HTTP_CLIENT`: not sufficient for operations that require
  database transactions, row locks, compare-and-set, or fencing unless an
  explicitly approved server-side RPC preserves all of those guarantees.
- `CONNECTION_POOLING_MODEL`: server-side bounded pool using the repository's
  approved PostgreSQL/Supabase deployment mode; pool exhaustion fails closed.
- `TLS_REQUIREMENT = REQUIRED`.
- `SECRET_ROTATION_EXPECTATION`: credentials must be rotatable without
  exposing them to clients or committing them; rotation failure fails closed.

No real credential, `DATABASE_URL`, service key, client bundle value, or
runtime configuration is introduced here.

## 9. Failure Model

The production adapter and future coordination adapter must fail closed on:

- production Map fallback or missing production adapter selection;
- unavailable database, missing required durable configuration, or pool
  exhaustion;
- malformed, corrupted, incomplete, or contradictory persisted state;
- isolation or canonical identity mismatch;
- stale expected version, fingerprint, or fencing token;
- conflicting owner, attempt, lifecycle, admission, or authorization;
- duplicate active ownership;
- transaction conflict, deadlock, rollback, or unknown commit outcome;
- an acknowledgement lost after a possible commit until durable truth is
  reconciled.

No uncertain state grants execution. `execution_allowed` remains false and
`production_effect` remains `ZERO` for the layers governed by this
contract.

## 10. Migration Strategy (Planning Only)

- `MIGRATION_FILE_CREATED = NO`.
- `MIGRATION_APPLIED = NO`.
- Use a versioned migration following the repository's approved PostgreSQL
  migration convention before any production adapter is enabled.
- Prefer a dedicated Hermes schema or clearly namespaced tables after an
  ownership review confirms the boundary.
- Add primary keys, canonical unique constraints, check constraints for
  allowed lifecycle states, indexes for exact identity/replay lookups, and
  indexes needed for future active ownership queries.
- Define RLS/security policies only after the Hermes contract carries the
  required tenant/workspace dimensions. RLS is an additional defense, not a
  substitute for application identity binding.
- Apply migrations only through the approved deployment process and an
  isolated integration environment first. PR-A performs no database write.
- Roll back only through a reviewed, versioned rollback or forward-fix plan;
  never silently drop authoritative state. Before first production use,
  rollback may remove an unused schema under an approved migration plan.
- Future changes must be additive or versioned so older readers fail closed
  on unknown state rather than misinterpreting it.

## 11. Approved PR Sequence

### PR-A: Durable Persistence Architecture Contract

This document. It establishes authority, identity, logical schema,
transactions, failure behavior, security, and sequencing. It creates no
runtime behavior.

### PR-B: PostgreSQL schema/migration and isolated integration-test infrastructure

PR-B may add reviewed schema/migrations and isolated test infrastructure. It
must not add the production Hermes adapter or shared coordination behavior.

### PR-C: `HermesVpsAuthorizationLifecyclePersistence` PostgreSQL production adapter

PR-C may implement the #133 interface against the approved durable plane,
with explicit dependency injection, no Map fallback, transaction semantics,
and fail-closed startup/runtime behavior. It must not implement #137 lease,
coordination, or external execution behavior.

### PR-D: PR #137 shared durable coordination

PR-D may implement the #136 coordination persistence boundary only after the
durable storage and adapter prerequisites are reviewed. It must not add an
executor, provider, SSH, shell, worker, deployment, or real operation.

No PR in this sequence may silently assume responsibility belonging to the
next PR.

## 12. Architectural Invariants

1. There is one authoritative owner for each durable Hermes state.
2. No implicit dual-write exists between Base44 and PostgreSQL.
3. Canonical identity and fingerprints are deterministic and immutable where
   the existing contracts require them to be immutable.
4. Isolation is enforced from contract-defined identity; missing dimensions
   are not invented by storage code.
5. Required transaction units are atomic or return a deterministic
   fail-closed result.
6. Equivalent retries are idempotent; conflicting retries are rejected.
7. Persistence failure never becomes execution permission.
8. A production Map-backed fallback is forbidden.
9. Database credentials are server-side only and never client-exposed.
10. Distributed ownership requires durable fencing before it can be used.
11. Restart, lost acknowledgement, stale writer, and unknown outcome paths
    reconcile from durable truth or remain non-executable.
12. The design remains backward compatible with the existing #133, #135,
    and #136 Hermes contracts.
13. PR-A introduces no executor, provider, network, SSH, shell, worker,
    deployment, secret, migration, database connection, or production write.

## 13. Explicit Non-Goals

This contract does not implement PostgreSQL, Supabase access, SQL, schema
migrations, RLS, leases, fencing, queueing, dispatch, workers, external
operation idempotency, execution receipts, provider calls, SSH, shell,
secrets, deployment, or real Hermes/VPS execution.

`PRODUCTION_WRITES = 0`.

`DATABASE_CONNECTION = NO`.

`PRODUCTION_ADAPTER_CREATED = NO`.

`PR137_IMPLEMENTED = NO`.

`DEPLOY = NO`.
