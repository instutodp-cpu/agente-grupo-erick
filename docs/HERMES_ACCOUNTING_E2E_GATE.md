# Accounting C0-C18 E2E Gate

This gate validates the first complete Hermes Accounting cycle across module boundaries.

## Happy path

```text
canonical fact + evidence
→ deterministic reconciliation
→ balanced journal draft
→ human-approved posting gate
→ close readiness
→ immutable close package
→ independent audit
→ accountant handoff readiness
```

The test is intentionally cross-module: passing isolated unit tests is not enough.

## Adversarial path

The gate also proves that:
- fiscal submission without approval fails closed;
- payment execution without approval is denied;
- unsupported document suppression requires evidence;
- artificial balancing entries are denied;
- an audit exception prevents accountant handoff.

## Promotion meaning

A green E2E gate means the C0-C18 contracts compose coherently at test level. It does **not** mean production readiness. Ground-truth fixture expansion, real integrations, shadow periods, persistence/transactionality and controlled production gates remain required.

## Merge authority

This gate does not grant merge authority. The PR remains Draft until explicitly reviewed and promoted by a human.
