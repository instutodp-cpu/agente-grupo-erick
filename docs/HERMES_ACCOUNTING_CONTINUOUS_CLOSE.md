# C10 — Continuous Close

C10 turns evidence and reconciliations into a controlled close process per company, establishment and competence.

## State machine

```text
OPEN → INGESTING → RECONCILING → EXCEPTIONS_PENDING
→ READY_FOR_REVIEW → HUMAN_REVIEW → READY_TO_CLOSE → CLOSED → LOCKED
```

A period may move backward before close when new evidence invalidates readiness. Closed/locked periods are never silently rewritten.

## Readiness

Readiness is deterministic. Coverage and evidence completeness are measured in basis points. A score is informational; any hard blocker overrides it, including:
- unresolved material exception;
- unexplained monetary variance;
- explicit close blocker.

A 100% score with a blocker is **not ready**.

## Daily and monthly close

The same contract supports store-level daily close and company/competence close by using `establishmentId` and competence dimensions. Later persistence may materialize dedicated DailyClose views.

## Late evidence and reopen

Evidence arriving after `CLOSED` or `LOCKED` creates a controlled reopen request. It does not mutate the historical package. Reopen remains pending human approval.

## Segregation of duties

Where applicable:

```text
PREPARER != REVIEWER != APPROVER
```

Final close requires readiness plus explicit human approval.

## Close package

A close produces an immutable package reference with an evidence-manifest hash. Later layers add journals, tax obligations and independent audit artifacts to that package.

## Not implemented

- persistence/locking database transaction;
- automatic reopen;
- journal posting;
- tax submission;
- payment execution.
