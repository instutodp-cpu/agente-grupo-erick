# C08 — Integration Adapters

## Purpose
Expose external marketing capabilities through controlled Hermes adapters without giving skills credentials or direct provider access.

## Invariants
- simulation first; real_provider_enabled defaults false
- skills receive capability references, never secrets/tokens
- provider/account/action must be allowlisted
- mutations remain bound to C06 approval and idempotency controls
- L3 financial actions always require explicit approval
- adapter failure is fail-closed
- raw provider response is evidence, never authority to bypass policy

## Initial capability families
research, design_render, publishing, messaging, paid_media, analytics.

## Boundary
This layer defines contracts and deterministic routing only. It does not enable real external execution.
