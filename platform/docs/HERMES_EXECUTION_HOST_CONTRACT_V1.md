# Hermes Execution Host Contract V1

This document defines an architectural contract for a future 24/7 Hermes
Execution Plane host. It does not provision infrastructure, deploy services,
configure DNS or authorize execution.

## Plane Separation

Base44 Maestro is the Control Plane. The future Hermes VPS host is the
Execution Plane. A host, service, worker, queue, scheduler or reverse proxy
is infrastructure only; none of them grants capability authorization.

The V1 contract is staging-only and production-blocked. It keeps outbound
network deny-by-default and requires a target policy, operation, context,
authorization binding and audit receipt before any future outbound action.

## Service Shape

The intended topology is:

```text
Internet -> HTTPS :443 -> Reverse Proxy -> Public Web Canary / Hermes API
                                      Hermes API -> Execution Gate
                                      Execution Gate -> Worker / Scheduler / Queue
```

Worker, scheduler and queue are separate services and remain subordinate to
the existing authorization contracts. Scheduler presence does not imply
dispatch; queue presence does not imply execution.

## Secrets and Audit

Secrets are never represented as plaintext in the repository, host contract,
filesystem, logs or receipts. Future runtime use requires explicit injection
through an approved mechanism and a logical binding/reference. Receipts must
carry correlation and authorization bindings without secret material.

## Public Web Canary

The Public Web Canary remains an isolated staging service. Its future health
surface is proof-only and must not call providers, resolve credentials, access
production data, mutate queues, start workers or create production effects.

## Deployment Intent

Future deployment should be containerized and reproducible, with health
checks, restart policies and resource limits. Docker Compose is preferred as
an architectural deployment description, but no executable compose file or
real deployment is introduced by this contract.
