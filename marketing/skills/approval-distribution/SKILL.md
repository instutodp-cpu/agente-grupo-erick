# C06 — Approval & Distribution Orchestration

## Purpose
Convert approved marketing artifacts into controlled distribution plans without performing external mutations in foundation mode.

## Flow
approved artifact -> distribution plan -> risk classification -> approval requirement -> scope lock -> idempotency -> execution intent -> simulation receipt

## Invariants
1. Distribution never bypasses the permission model.
2. Organic publishing and message sending are L2; ad/budget mutations are L3.
3. Approval is bound to exact action scope and artifact hash.
4. Approval cannot be reused for a changed artifact, channel, audience, account, budget or action.
5. Every mutation intent requires an idempotency key.
6. Foundation mode produces simulation receipts only.
7. No provider credentials are accepted by skills.
8. A render-ready artifact is not automatically publish-ready.

## Supported plan targets
- Instagram organic
- WhatsApp draft/send intent
- paid media draft/mutation intent
- generic distribution adapter

## Execution
Simulation First. external_execution=false. No publishing, messaging, ad mutation or spend.
