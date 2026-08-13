# Hermes Execution Host Contract V1

This document defines the host/readiness and durable audit/observability
contract for a future 24/7 Hermes Execution Plane host. PR #128 does not
provision infrastructure, deploy services, configure DNS, or authorize
execution.

## Plane Separation

Base44 Maestro is the Control Plane. The future Hermes VPS host is the
Execution Plane. A host, service, worker, queue, scheduler or reverse proxy
is infrastructure only; none of them grants capability authorization.

The V1 contract is staging-only and production-blocked. It keeps outbound
network deny-by-default and models four separate readiness layers: host,
runtime, admission, and durable audit/observability. Readiness at any of
those layers is not production execution authorization.

The canonical execution chain is:

```text
Bootstrap -> Provisioning Plan -> Authorization -> Lifecycle
          -> Durable Lifecycle -> Attempt Ownership -> Trusted Admission
          -> future executor
```

PR #135 owns the trusted durable admission boundary. This host contract only
correlates the canonical plan, authorization, lifecycle, attempt-owner and
admission identities; it does not replace or reimplement those contracts.

## Service Shape

The intended topology is:

```text
Internet -> HTTPS :443 -> Reverse Proxy -> Public Web Canary / Hermes API
                                      Hermes API -> Execution Gate
                                      Execution Gate -> Worker / Scheduler / Queue
```

Worker, scheduler and queue are separate service-shape declarations and remain
subordinate to the existing authorization contracts and PR #135 admission.
Scheduler presence does not imply dispatch; queue presence does not imply
execution. No runtime is wired by this PR.

## Secrets and Audit

Secrets are never represented as plaintext in the repository, host contract,
filesystem, logs or receipts. Future runtime use requires explicit injection
through an approved mechanism and a logical binding/reference. Receipts must
carry correlation, authorization, lifecycle, owner, attempt, admission and
replay bindings without secret material. Durable audit and reconciliation are
requirements for a future adapter, not a production store implemented here.

## Public Web Canary

The Public Web Canary remains an isolated staging service. Its future health
surface is proof-only and must not call providers, resolve credentials, access
production data, mutate queues, start workers or create production effects.

## Deployment Intent

Future deployment may be containerized and reproducible, with health
checks, restart policies and resource limits. Docker Compose is preferred as
an architectural deployment description, but no executable compose file,
deployment, provider/network/SSH path, production durable adapter, or real
deployment is introduced by this contract.

## Fail-closed boundary

Missing, malformed, stale, contradictory, or mismatched canonical evidence
must leave readiness blocked. Owner identity, attempt identity, admission
identity, lifecycle reference, correlation identity and replay identity are
correlated but sourced from the existing contracts. A host can be ready while
runtime, admission, audit, or production authorization remains unavailable.

Restart and replay reconciliation require durable state from the existing
lifecycle/admission boundaries and a future shared persistence adapter. This
PR makes those requirements explicit and testable; it does not claim database
durability, multi-instance atomicity, provider outcome recovery, or exactly-once
external execution.

## Explicit exclusions

This PR adds no provider SDK, network call, SSH, shell, worker runtime, queue
dispatch, scheduler execution, secret material, production configuration,
production durable adapter, executor, deployment, or Hermes/VPS operation.
Real execution remains a later separately authorized phase.
